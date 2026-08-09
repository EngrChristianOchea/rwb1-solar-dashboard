// api/control.js
//
// Solar of Things inverter control API
//
// Supported actions:
//   startCharging
//   stopCharging
//   setChargingCurrent
//   setBatteryCV
//   setBatteryFloat
//   setValue
//
// IMPORTANT:
// This file must be deployed as:
//   /api/control.js
//
// The frontend should call:
//   POST /api/control
//

import dotenv from "dotenv";
import CryptoJS from "crypto-js";

dotenv.config({ path: ".env.local" });

const OPEN_APP_ID = "rBrTRfAPXz";

const ENCRYPTED_OPEN_APP_SECRET =
  "I4D0KRr2339z3pQ/at91V9BpFAOe54DaTafwSm6suIQ=";

const BASE_URL = "https://solar.siseli.com/apis";

let cachedToken = null;
let cachedTokenExpiry = 0;


// ============================================================
// Utility
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

  return CryptoJS.SHA256(
    CryptoJS.enc.Utf8.parse(bodyString)
  )
    .toString()
    .toLowerCase();
}


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

  signParams["IOT-Open-Body-Hash"] =
    getBodyHash(method, bodyString);

  signParams["IOT-Open-AppID"] =
    OPEN_APP_ID;

  signParams["IOT-Open-Nonce"] =
    nonce;

  const sortedParams =
    sortObject(signParams);

  const queryString =
    stringifyQueryNoEncode(sortedParams);

  const queryBase64 =
    CryptoJS.enc.Base64.stringify(
      CryptoJS.enc.Utf8.parse(queryString)
    );

  const openSecret =
    decryptOpenSecret(
      OPEN_APP_ID,
      ENCRYPTED_OPEN_APP_SECRET
    );

  const hmac =
    CryptoJS.HmacSHA256(
      queryBase64,
      openSecret
    );

  const sign =
    CryptoJS.MD5(hmac)
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

  const account =
    process.env.SOT_ACCOUNT;

  const password =
    process.env.SOT_PASSWORD_HASH;

  if (!account || !password) {
    throw new Error(
      "Missing SOT_ACCOUNT or SOT_PASSWORD_HASH in environment variables."
    );
  }

  const url =
    `${BASE_URL}/login/account`;

  const bodyString =
    JSON.stringify({
      account,
      password
    });

  const openHeaders =
    makeOpenHeaders({
      url,
      method: "POST",
      bodyString
    });

  const response =
    await fetch(url, {
      method: "POST",

      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",

        "Content-Type":
          "application/json; charset=utf-8",

        ...openHeaders,

        "IOT-Time-Zone":
          "Asia/Singapore",

        "IOT-Token":
          "null",

        Origin:
          "https://solar.siseli.com",

        Referer:
          "https://solar.siseli.com/",

        "User-Agent":
          "Mozilla/5.0"
      },

      body: bodyString
    });

  const text =
    await response.text();

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `Solar login returned non-JSON response (${response.status}): ${text.substring(
        0,
        300
      )}`
    );
  }

  if (!response.ok || json.code !== 0) {
    throw new Error(
      json.message ||
      `Solar login failed with HTTP ${response.status}`
    );
  }

  const accessToken =
    json?.data?.accessToken;

  const expiresAt =
    json?.data?.accessTokenWillExpiredAt;

  if (!accessToken) {
    throw new Error(
      "Solar login succeeded, but no accessToken was returned."
    );
  }

  cachedToken =
    accessToken;

  cachedTokenExpiry =
    expiresAt
      ? new Date(expiresAt).getTime()
      : Date.now() + 60 * 60 * 1000;

  return accessToken;
}


// ============================================================
// Get valid token
// ============================================================

async function getValidToken() {

  const now =
    Date.now();

  if (
    cachedToken &&
    now <
      cachedTokenExpiry -
        5 * 60 * 1000
  ) {
    return cachedToken;
  }

  return loginToSolarOfThings();
}


// ============================================================
// Solar API request
// ============================================================

async function solarRequest(
  url,
  options = {}
) {

  let token =
    await getValidToken();

  let response =
    await fetch(url, {
      ...options,

      headers: {
        Accept:
          "application/json",

        "Accept-Language":
          "en-US",

        "IOT-Time-Zone":
          "Asia/Singapore",

        "IOT-Token":
          token,

        Origin:
          "https://solar.siseli.com",

        Referer:
          "https://solar.siseli.com/",

        "User-Agent":
          "Mozilla/5.0",

        ...(options.headers || {})
      }
    });

  /*
   * If the token expired unexpectedly,
   * login once more and retry.
   */

  if (
    response.status === 401 ||
    response.status === 403
  ) {

    cachedToken = null;
    cachedTokenExpiry = 0;

    token =
      await getValidToken();

    response =
      await fetch(url, {
        ...options,

        headers: {
          Accept:
            "application/json",

          "Accept-Language":
            "en-US",

          "IOT-Time-Zone":
            "Asia/Singapore",

          "IOT-Token":
            token,

          Origin:
            "https://solar.siseli.com",

          Referer:
            "https://solar.siseli.com/",

          "User-Agent":
            "Mozilla/5.0",

          ...(options.headers || {})
        }
      });
  }

  const text =
    await response.text();

  let json = null;

  try {
    json =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    throw new Error(
      `Solar API returned non-JSON response (${response.status}): ${text.substring(
        0,
        500
      )}`
    );
  }

  if (!response.ok) {
    throw new Error(
      json?.message ||
      json?.error ||
      `Solar API HTTP ${response.status}`
    );
  }

  return json;
}


// ============================================================
// Device ID
// ============================================================

function getDeviceId() {

  const deviceId =
    process.env.DEVICE_ID ||
    process.env.SISELI_DEVICE_ID;

  if (!deviceId) {
    throw new Error(
      "Missing DEVICE_ID environment variable."
    );
  }

  return deviceId;
}


// ============================================================
// WRITE CONFIG
// ============================================================

async function writeConfig(
  key,
  value
) {

  const deviceId =
    getDeviceId();

  const url =
    `${BASE_URL}/remote/device/config/write` +
    `?deviceId=${encodeURIComponent(deviceId)}`;

  /*
   * IMPORTANT:
   * Siseli's actual request uses:
   *
   * {
   *   "id": "<DEVICE_ID>",
   *   "key": "...",
   *   "value": "..."
   * }
   */

  const body =
    JSON.stringify({
      id: deviceId,
      key,
      value: String(value)
    });

  console.log(
    "Siseli WRITE:",
    {
      deviceId,
      key,
      value: String(value)
    }
  );

  const result =
    await solarRequest(
      url,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json; charset=utf-8"
        },

        body
      }
    );

  return result;
}


// ============================================================
// READ LATEST STATE
// ============================================================

async function getLatestState() {

  const deviceId =
    getDeviceId();

  const url =
    `${BASE_URL}/deviceState/simple/state/latest/v1` +
    `?deviceId=${encodeURIComponent(deviceId)}` +
    `&dataSource=1`;

  return solarRequest(
    url,
    {
      method: "GET"
    }
  );
}


// ============================================================
// CHARGING FUNCTIONS
// ============================================================

async function startCharging() {

  /*
   * This follows the exact configuration
   * write observed from Siseli.
   *
   * 60A is the example value captured
   * from the Siseli UI.
   */

  const result =
    await writeConfig(
      "setMaxChargingCurrent",
      "60"
    );

  return {
    action: "startCharging",
    key: "setMaxChargingCurrent",
    value: "60",
    result
  };
}


async function stopCharging() {

  /*
   * Set charging current to zero.
   */

  const result =
    await writeConfig(
      "setMaxChargingCurrent",
      "0"
    );

  return {
    action: "stopCharging",
    key: "setMaxChargingCurrent",
    value: "0",
    result
  };
}


async function setChargingCurrent(
  current
) {

  if (
    current === undefined ||
    current === null ||
    Number.isNaN(Number(current))
  ) {
    throw new Error(
      "Charging current is required."
    );
  }

  const value =
    Number(current);

  if (value < 0 || value > 120) {
    throw new Error(
      "Charging current must be between 0A and 120A."
    );
  }

  const result =
    await writeConfig(
      "setMaxChargingCurrent",
      String(value)
    );

  return {
    action:
      "setChargingCurrent",

    key:
      "setMaxChargingCurrent",

    value:
      String(value),

    result
  };
}


// ============================================================
// Battery voltage functions
// ============================================================

async function setBatteryCV(
  voltage
) {

  if (
    voltage === undefined ||
    voltage === null
  ) {
    throw new Error(
      "Battery CV voltage is required."
    );
  }

  return writeConfig(
    "setBatteryCVChargeVoltage",
    String(voltage)
  );
}


async function setBatteryFloat(
  voltage
) {

  if (
    voltage === undefined ||
    voltage === null
  ) {
    throw new Error(
      "Battery float voltage is required."
    );
  }

  return writeConfig(
    "setBatteryFloatChargeVoltage",
    String(voltage)
  );
}


// ============================================================
// Generic configuration
// ============================================================

async function setValue(
  key,
  value
) {

  if (!key) {
    throw new Error(
      "Configuration key is required."
    );
  }

  if (
    value === undefined ||
    value === null
  ) {
    throw new Error(
      "Configuration value is required."
    );
  }

  return writeConfig(
    key,
    value
  );
}


// ============================================================
// HTTP HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {

  /*
   * CORS
   */

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res
      .status(200)
      .end();
  }


  try {

    /*
     * GET = read latest inverter state
     */

    if (req.method === "GET") {

      const result =
        await getLatestState();

      return res
        .status(200)
        .json({
          ok: true,
          result
        });
    }


    if (req.method !== "POST") {

      return res
        .status(405)
        .json({
          ok: false,
          error:
            "Method not allowed."
        });
    }


    /*
     * Parse request body
     */

    let body =
      req.body;

    if (
      typeof body === "string"
    ) {
      try {
        body =
          JSON.parse(body);
      } catch {
        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Invalid JSON request body."
          });
      }
    }


    const action =
      body?.action;


    /*
     * DEBUG
     */

    console.log(
      "Control action:",
      action,
      body
    );


    /*
     * START CHARGING
     */

    if (
      action === "startCharging"
    ) {

      const result =
        await startCharging();

      return res
        .status(200)
        .json({
          ok: true,
          ...result
        });
    }


    /*
     * STOP CHARGING
     */

    if (
      action === "stopCharging"
    ) {

      const result =
        await stopCharging();

      return res
        .status(200)
        .json({
          ok: true,
          ...result
        });
    }


    /*
     * SET CHARGING CURRENT
     */

    if (
      action === "setChargingCurrent"
    ) {

      const result =
        await setChargingCurrent(
          body.current ??
          body.value
        );

      return res
        .status(200)
        .json({
          ok: true,
          ...result
        });
    }


    /*
     * SET BATTERY CV
     */

    if (
      action === "setBatteryCV"
    ) {

      const result =
        await setBatteryCV(
          body.voltage ??
          body.value
        );

      return res
        .status(200)
        .json({
          ok: true,
          result
        });
    }


    /*
     * SET BATTERY FLOAT
     */

    if (
      action === "setBatteryFloat"
    ) {

      const result =
        await setBatteryFloat(
          body.voltage ??
          body.value
        );

      return res
        .status(200)
        .json({
          ok: true,
          result
        });
    }


    /*
     * GENERIC CONFIGURATION
     */

    if (
      action === "setValue"
    ) {

      const result =
        await setValue(
          body.key,
          body.value
        );

      return res
        .status(200)
        .json({
          ok: true,
          result
        });
    }


    /*
     * UNKNOWN ACTION
     */

    return res
      .status(400)
      .json({
        ok: false,
        error:
          "Unknown control action.",
        receivedAction:
          action,
        supportedActions: [
          "startCharging",
          "stopCharging",
          "setChargingCurrent",
          "setBatteryCV",
          "setBatteryFloat",
          "setValue"
        ]
      });

  } catch (error) {

    console.error(
      "Solar control error:",
      error
    );

    return res
      .status(500)
      .json({
        ok: false,
        error:
          error?.message ||
          "Solar control request failed."
      });
  }
}