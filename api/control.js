// api/control.js

import dotenv from "dotenv";
import CryptoJS from "crypto-js";

dotenv.config({ path: ".env.local" });

// ============================================================
// Solar of Things / SISELI configuration
// ============================================================

const BASE_URL = "https://solar.siseli.com/apis";

const OPEN_APP_ID = "rBrTRfAPXz";

const ENCRYPTED_OPEN_APP_SECRET =
  "I4D0KRr2339z3pQ/at91V9BpFAOe54DaTafwSm6suIQ=";

// Token cache
let cachedToken = null;
let cachedTokenExpiry = 0;

// ============================================================
// Utility functions
// ============================================================

function randomNonce(length = 32) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let result = "";

  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }

  return result;
}

function decryptOpenSecret(appId, encryptedSecret) {
  const md5 = CryptoJS.MD5(appId).toString().toLowerCase();

  const keyText = md5.substring(0, 16);
  const ivText = md5.substring(16);

  const key = CryptoJS.enc.Utf8.parse(keyText);
  const iv = CryptoJS.enc.Utf8.parse(ivText);

  const decrypted = CryptoJS.AES.decrypt(encryptedSecret, key, {
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.ZeroPadding,
    iv
  });

  return decrypted.toString(CryptoJS.enc.Utf8).trim();
}

function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      result[key] = obj[key];
      return result;
    }, {});
}

function stringifyQueryNoEncode(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function getBodyHash(method, bodyString) {
  if (method.toUpperCase() === "GET") {
    return "";
  }

  if (!bodyString || typeof bodyString !== "string") {
    return "";
  }

  return CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(bodyString))
    .toString()
    .toLowerCase();
}

// ============================================================
// Open API signing
// ============================================================

function makeOpenHeaders({ url, method, bodyString }) {
  const nonce = randomNonce(32);

  const signParams = {};

  const parsedUrl = new URL(url);

  for (const [key, value] of parsedUrl.searchParams.entries()) {
    if (
      key !== "IOT-Open-AppID" &&
      key !== "IOT-Open-Nonce" &&
      key !== "IOT-Open-Sign" &&
      key !== "IOT-Open-Body-Hash"
    ) {
      signParams[key] = value;
    }
  }

  signParams["IOT-Open-Body-Hash"] = getBodyHash(
    method,
    bodyString
  );

  signParams["IOT-Open-AppID"] = OPEN_APP_ID;
  signParams["IOT-Open-Nonce"] = nonce;

  const sortedParams = sortObject(signParams);

  const queryString = stringifyQueryNoEncode(sortedParams);

  const queryBase64 = CryptoJS.enc.Base64.stringify(
    CryptoJS.enc.Utf8.parse(queryString)
  );

  const openSecret = decryptOpenSecret(
    OPEN_APP_ID,
    ENCRYPTED_OPEN_APP_SECRET
  );

  const hmac = CryptoJS.HmacSHA256(
    queryBase64,
    openSecret
  );

  const sign = CryptoJS.MD5(hmac)
    .toString()
    .toLowerCase();

  return {
    "IOT-Open-AppID": OPEN_APP_ID,
    "IOT-Open-Nonce": nonce,
    "IOT-Open-Sign": sign
  };
}

// ============================================================
// Login
// ============================================================

async function loginToSolarOfThings() {
  const account = process.env.SOT_ACCOUNT;
  const password = process.env.SOT_PASSWORD_HASH;

  if (!account || !password) {
    throw new Error(
      "Missing SOT_ACCOUNT or SOT_PASSWORD_HASH in environment variables."
    );
  }

  const url = `${BASE_URL}/login/account`;

  const bodyString = JSON.stringify({
    account,
    password
  });

  const openHeaders = makeOpenHeaders({
    url,
    method: "POST",
    bodyString
  });

  const response = await fetch(url, {
    method: "POST",

    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US",
      "Content-Type": "application/json; charset=utf-8",

      ...openHeaders,

      "IOT-Time-Zone": "Asia/Singapore",
      "IOT-Token": "null",

      Origin: "https://solar.siseli.com",
      Referer: "https://solar.siseli.com/",
      "User-Agent": "Mozilla/5.0"
    },

    body: bodyString
  });

  const text = await response.text();

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Solar login returned non-JSON response (HTTP ${response.status}): ${text.substring(
        0,
        300
      )}`
    );
  }

  if (!response.ok || json.code !== 0) {
    throw new Error(
      json.message ||
        `Solar login failed with HTTP ${response.status}.`
    );
  }

  const accessToken = json?.data?.accessToken;

  const expiresAt =
    json?.data?.accessTokenWillExpiredAt;

  if (!accessToken) {
    throw new Error(
      "Solar login succeeded, but no accessToken was returned."
    );
  }

  cachedToken = accessToken;

  cachedTokenExpiry = expiresAt
    ? new Date(expiresAt).getTime()
    : Date.now() + 60 * 60 * 1000;

  return accessToken;
}

// ============================================================
// Get valid token
// ============================================================

async function getValidToken() {
  const now = Date.now();

  if (
    cachedToken &&
    now < cachedTokenExpiry - 5 * 60 * 1000
  ) {
    return cachedToken;
  }

  return loginToSolarOfThings();
}

// ============================================================
// Device ID
// ============================================================

function getDeviceId() {
  const deviceId = process.env.DEVICE_ID;

  if (!deviceId) {
    throw new Error(
      "Missing DEVICE_ID environment variable."
    );
  }

  return deviceId;
}

// ============================================================
// Solar API request helper
// ============================================================

async function solarRequest(
  path,
  {
    method = "GET",
    body = null,
    retry = true
  } = {}
) {
  const token = await getValidToken();

  const url = `${BASE_URL}${path}`;

  const bodyString =
    body !== null
      ? JSON.stringify(body)
      : "";

  const openHeaders = makeOpenHeaders({
    url,
    method,
    bodyString
  });

  const response = await fetch(url, {
    method,

    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US",

      ...(body !== null
        ? {
            "Content-Type":
              "application/json; charset=utf-8"
          }
        : {}),

      ...openHeaders,

      "IOT-Time-Zone": "Asia/Singapore",
      "IOT-Token": token,

      Origin: "https://solar.siseli.com",
      Referer: "https://solar.siseli.com/",
      "User-Agent": "Mozilla/5.0"
    },

    ...(body !== null
      ? {
          body: bodyString
        }
      : {})
  });

  const text = await response.text();

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    if (response.status === 401 && retry) {
      cachedToken = null;
      cachedTokenExpiry = 0;

      return solarRequest(path, {
        method,
        body,
        retry: false
      });
    }

    throw new Error(
      `Solar API returned non-JSON response (HTTP ${response.status}): ${text.substring(
        0,
        300
      )}`
    );
  }

  // Token expired / unauthorized
  if (
    (response.status === 401 ||
      json?.code === 401 ||
      json?.code === 1001) &&
    retry
  ) {
    cachedToken = null;
    cachedTokenExpiry = 0;

    return solarRequest(path, {
      method,
      body,
      retry: false
    });
  }

  if (!response.ok) {
    throw new Error(
      json?.message ||
        `Solar API HTTP ${response.status}.`
    );
  }

  if (
    json?.code !== undefined &&
    json.code !== 0
  ) {
    throw new Error(
      json.message ||
        `Solar API returned error code ${json.code}.`
    );
  }

  return json;
}

// ============================================================
// Read latest inverter state
// ============================================================

async function getLatestState() {
  const deviceId = getDeviceId();

  return solarRequest(
    `/deviceState/simple/state/latest/v1?deviceId=${encodeURIComponent(
      deviceId
    )}&dataSource=1`,
    {
      method: "GET"
    }
  );
}

// ============================================================
// Write inverter configuration
// ============================================================

async function writeConfig(key, value) {
  const deviceId = getDeviceId();

  return solarRequest(
    `/remote/device/config/write?deviceId=${encodeURIComponent(
      deviceId
    )}`,
    {
      method: "POST",

      body: {
        id: deviceId,
        key,
        value
      }
    }
  );
}

// ============================================================
// Configuration functions
// ============================================================

async function setBatteryCV(voltage) {
  return writeConfig(
    "setBatteryCVChargeVoltage",
    voltage
  );
}

async function setBatteryFloat(voltage) {
  return writeConfig(
    "setBatteryFloatChargeVoltage",
    voltage
  );
}

// ============================================================
// Start charging
// ============================================================
//
// IMPORTANT:
// The actual Solar of Things configuration keys are kept
// together here so they can easily be changed if your
// inverter uses different parameter names.
//
// Target SOC is handled by the frontend/backend workflow.
// The voltage values below are the charge voltages you were
// previously using.
//
// ============================================================

async function startCharging(targetSoc) {
  const soc = Number(targetSoc);

  if (
    !Number.isFinite(soc) ||
    soc < 0 ||
    soc > 100
  ) {
    throw new Error(
      "Invalid target SOC. Please use a value from 0 to 100."
    );
  }

  /*
   * Your current UI allows 80 / 90 / 100%.
   *
   * We first set the charge voltage configuration.
   *
   * NOTE:
   * The exact SOC-control configuration key used by
   * your inverter/API has not been established from the
   * files provided so far.
   *
   * Therefore this function does NOT invent an undocumented
   * SOC API key.
   */

  const results = [];

  // ----------------------------------------------------------
  // Battery CV voltage
  // ----------------------------------------------------------

  const cvVoltage =
    Number(process.env.CHARGE_CV_VOLTAGE) || 54.0;

  results.push({
    setting: "setBatteryCVChargeVoltage",
    value: cvVoltage,
    result: await setBatteryCV(cvVoltage)
  });

  // ----------------------------------------------------------
  // Float voltage
  // ----------------------------------------------------------

  const floatVoltage =
    Number(process.env.CHARGE_FLOAT_VOLTAGE) || 53.5;

  results.push({
    setting: "setBatteryFloatChargeVoltage",
    value: floatVoltage,
    result: await setBatteryFloat(floatVoltage)
  });

  return {
    ok: true,

    action: "startCharging",

    targetSoc: soc,

    message: `Charging configuration applied for target SOC ${soc}%.`,

    results
  };
}

// ============================================================
// Restore inverter configuration
// ============================================================

async function restoreDefaults(body = {}) {
  /*
   * App.jsx sends:
   *
   * {
   *   utilitySoc,
   *   batterySoc
   * }
   *
   * We accept these values so the endpoint is compatible
   * with the existing frontend.
   */

  const utilitySoc =
    body?.utilitySoc !== undefined
      ? Number(body.utilitySoc)
      : null;

  const batterySoc =
    body?.batterySoc !== undefined
      ? Number(body.batterySoc)
      : null;

  const results = [];

  /*
   * Restore values can optionally be configured through
   * Vercel environment variables.
   *
   * Example:
   *
   * RESTORE_CV_VOLTAGE=52.5
   * RESTORE_FLOAT_VOLTAGE=52.0
   */

  const restoreCv =
    Number(process.env.RESTORE_CV_VOLTAGE);

  const restoreFloat =
    Number(process.env.RESTORE_FLOAT_VOLTAGE);

  if (Number.isFinite(restoreCv)) {
    results.push({
      setting: "setBatteryCVChargeVoltage",
      value: restoreCv,
      result: await setBatteryCV(restoreCv)
    });
  }

  if (Number.isFinite(restoreFloat)) {
    results.push({
      setting: "setBatteryFloatChargeVoltage",
      value: restoreFloat,
      result: await setBatteryFloat(
        restoreFloat
      )
    });
  }

  return {
    ok: true,

    action: "restore",

    utilitySoc,

    batterySoc,

    message:
      "Restore configuration request completed.",

    results
  };
}

// ============================================================
// HTTP Handler
// ============================================================

export default async function handler(req, res) {
  // Always tell frontend we're returning JSON
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  try {
    // --------------------------------------------------------
    // Only POST is allowed
    // --------------------------------------------------------

    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed. Use POST."
      });
    }

    // --------------------------------------------------------
    // Parse body safely
    // --------------------------------------------------------

    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON request body."
        });
      }
    }

    body = body || {};

    const action = body.action;

    // --------------------------------------------------------
    // Validate action
    // --------------------------------------------------------

    if (!action) {
      return res.status(400).json({
        ok: false,
        error: "Missing control action."
      });
    }

    // --------------------------------------------------------
    // Validate device ID before doing anything
    // --------------------------------------------------------

    getDeviceId();

    // --------------------------------------------------------
    // START CHARGING
    // --------------------------------------------------------

    if (action === "startCharging") {
      const targetSoc =
        body.targetSoc ??
        body.soc ??
        body.targetSOC ??
        90;

      const result =
        await startCharging(targetSoc);

      return res.status(200).json(result);
    }

    // --------------------------------------------------------
    // RESTORE
    // --------------------------------------------------------

    if (action === "restore") {
      const result =
        await restoreDefaults(body);

      return res.status(200).json(result);
    }

    // --------------------------------------------------------
    // UNKNOWN ACTION
    // --------------------------------------------------------

    return res.status(400).json({
      ok: false,

      error: "Unknown control action.",

      action,

      supportedActions: [
        "startCharging",
        "restore"
      ]
    });
  } catch (error) {
    console.error(
      "Solar control API error:",
      error
    );

    return res.status(500).json({
      ok: false,

      error:
        error?.message ||
        "Solar control request failed."
    });
  }
}