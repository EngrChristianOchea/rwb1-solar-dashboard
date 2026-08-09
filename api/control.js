import dotenv from "dotenv";
import CryptoJS from "crypto-js";

dotenv.config({ path: ".env.local" });

const SISELI_BASE_URL = "https://solar.siseli.com";

const DEFAULT_GRID_SOC = 22;
const DEFAULT_BATTERY_SOC = 35;

const OPEN_APP_ID = "rBrTRfAPXz";

const ENCRYPTED_OPEN_APP_SECRET =
  "I4D0KRr2339z3pQ/at91V9BpFAOe54DaTafwSm6suIQ=";

// ------------------------------------------------------------
// Dynamic Solar of Things token cache
// ------------------------------------------------------------

let cachedToken = null;
let cachedTokenExpiry = 0;

// ------------------------------------------------------------
// Open API signing helpers
// ------------------------------------------------------------

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

  signParams["IOT-Open-Body-Hash"] = getBodyHash(method, bodyString);
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

  const hmac = CryptoJS.HmacSHA256(queryBase64, openSecret);

  const sign = CryptoJS.MD5(hmac).toString().toLowerCase();

  return {
    "IOT-Open-AppID": OPEN_APP_ID,
    "IOT-Open-Nonce": nonce,
    "IOT-Open-Sign": sign
  };
}

// ------------------------------------------------------------
// Dynamic login
// Same mechanism used by solar.js
// ------------------------------------------------------------

async function loginToSolarOfThings() {
  const account = process.env.SOT_ACCOUNT;
  const password = process.env.SOT_PASSWORD_HASH;

  if (!account || !password) {
    throw new Error(
      "Missing SOT_ACCOUNT or SOT_PASSWORD_HASH in environment variables."
    );
  }

  const url = `${SISELI_BASE_URL}/apis/login/account`;

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
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok || json?.code !== 0) {
    throw new Error(
      json?.message || "Solar of Things login failed."
    );
  }

  const accessToken = json?.data?.accessToken;
  const expiresAt = json?.data?.accessTokenWillExpiredAt;

  if (!accessToken) {
    throw new Error(
      "Login succeeded, but no accessToken was returned."
    );
  }

  cachedToken = accessToken;

  cachedTokenExpiry = expiresAt
    ? new Date(expiresAt).getTime()
    : Date.now() + 60 * 60 * 1000;

  console.log(
    "SiSeli dynamic token acquired. Expiry:",
    new Date(cachedTokenExpiry).toISOString()
  );

  return accessToken;
}

async function getValidToken() {
  const now = Date.now();

  if (
    cachedToken &&
    now < cachedTokenExpiry - 5 * 60 * 1000
  ) {
    return cachedToken;
  }

  console.log("SiSeli token missing/expired. Logging in...");

  return await loginToSolarOfThings();
}

// ------------------------------------------------------------
// Configuration writer
// ------------------------------------------------------------

async function writeConfigWithToken(key, value, token) {
  const deviceId = process.env.DEVICE_ID;

  if (!deviceId) {
    throw new Error(
      "Missing SISELI_DEVICE_ID environment variable."
    );
  }

  const url =
    `${SISELI_BASE_URL}/apis/remote/device/config/write` +
    `?deviceId=${encodeURIComponent(deviceId)}`;

  const body = {
    id: deviceId,
    key,
    value: String(value)
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "IOT-Time-Zone": "Asia/Singapore",
      "IOT-Token": token,
      Origin: "https://solar.siseli.com",
      Referer: "https://solar.siseli.com/"
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  console.log("SiSeli write:", {
    key,
    value,
    status: response.status,
    response: data
  });

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        `SiSeli rejected ${key}=${value} (${response.status})`
    );

    error.status = response.status;
    error.responseData = data;

    throw error;
  }

  if (data && typeof data === "object" && data.code !== undefined) {
    if (Number(data.code) !== 0) {
      const error = new Error(
        data.message ||
          `SiSeli rejected ${key}=${value}.`
      );

      error.status = response.status;
      error.responseData = data;

      throw error;
    }
  }

  return data;
}

// ------------------------------------------------------------
// Write configuration using dynamic token
// Automatically retries once after token refresh.
// ------------------------------------------------------------

async function writeConfig(key, value) {
  let token = await getValidToken();

  try {
    return await writeConfigWithToken(key, value, token);
  } catch (error) {
    const status = Number(error?.status);

    const message = String(error?.message || "").toLowerCase();

    const tokenError =
      status === 401 ||
      status === 403 ||
      message.includes("token") ||
      message.includes("unauthorized") ||
      message.includes("expired");

    if (!tokenError) {
      throw error;
    }

    console.warn(
      "SiSeli token appears invalid/expired. Refreshing token and retrying..."
    );

    cachedToken = null;
    cachedTokenExpiry = 0;

    token = await getValidToken();

    return await writeConfigWithToken(
      key,
      value,
      token
    );
  }
}

// ------------------------------------------------------------
// API HANDLER
// ------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const {
      action,
      currentSoc,
      utilitySoc,
      batterySoc
    } = req.body || {};

    const deviceId = process.env.DEVICE_ID;

    if (!deviceId) {
      throw new Error(
        "Missing SISELI_DEVICE_ID environment variable."
      );
    }

    // --------------------------------------------------------
    // START MANUAL GRID CHARGING
    // --------------------------------------------------------

    if (action === "startCharging") {
      const current = Number(currentSoc);
      const requestedUtilitySoc = Number(utilitySoc);
      const target = Number(batterySoc);

      if (!Number.isFinite(current)) {
        throw new Error("Invalid current SOC.");
      }

      if (!Number.isFinite(target)) {
        throw new Error("Invalid target SOC.");
      }

      if (target <= current) {
        throw new Error(
          `Target SOC ${target}% is not above current SOC ${current}%.`
        );
      }

      if (target > 100) {
        throw new Error("Target SOC cannot exceed 100%.");
      }

      /*
       * During manual charging:
       *
       * Utility comeback:
       *   Set to current SOC or lower.
       *
       * Battery comeback:
       *   Set to user's target SOC.
       *
       * Example:
       *
       * Current SOC = 48%
       * Utility comeback = 48%
       * Battery comeback = 90%
       *
       * This forces the inverter to stay on/use utility
       * until the battery reaches the requested target.
       */

      const forcedUtilitySoc = Math.min(
        Math.floor(current),
        Number.isFinite(requestedUtilitySoc)
          ? Math.floor(requestedUtilitySoc)
          : DEFAULT_GRID_SOC
      );

      const forcedBatterySoc = Math.min(
        Math.max(Math.floor(target), 1),
        100
      );

      console.log(
        "Starting manual charging:",
        {
          currentSoc: current,
          utilitySoc: forcedUtilitySoc,
          targetSoc: forcedBatterySoc
        }
      );

      // FIRST: utility comeback threshold
      const utilityResult = await writeConfig(
        "comebackUtilityModeSocPointUnderSBU",
        forcedUtilitySoc
      );

      // SECOND: battery comeback threshold
      const batteryResult = await writeConfig(
        "comebackBatteryModeSocPoint",
        forcedBatterySoc
      );

      /*
       * IMPORTANT:
       * Do NOT restore defaults here.
       *
       * Defaults:
       *   Utility = 22%
       *   Battery = 35%
       *
       * Restoring immediately would cancel the manual
       * charging configuration.
       */

      return res.status(200).json({
        ok: true,
        action: "startCharging",

        currentSoc: current,

        utilitySoc: forcedUtilitySoc,

        batterySoc: forcedBatterySoc,

        utilityResult,

        batteryResult,

        message:
          `Manual grid charging started. ` +
          `Utility comeback set to ${forcedUtilitySoc}% ` +
          `and battery target set to ${forcedBatterySoc}%.`
      });
    }

    // --------------------------------------------------------
    // RESTORE DEFAULT SETTINGS
    // --------------------------------------------------------

    if (action === "restore") {
      const restoreUtilitySoc = Number.isFinite(
        Number(utilitySoc)
      )
        ? Math.min(
            Math.max(Math.floor(Number(utilitySoc)), 0),
            100
          )
        : DEFAULT_GRID_SOC;

      const restoreBatterySoc = Number.isFinite(
        Number(batterySoc)
      )
        ? Math.min(
            Math.max(Math.floor(Number(batterySoc)), 0),
            100
          )
        : DEFAULT_BATTERY_SOC;

      console.log(
        "Restoring inverter defaults:",
        {
          utilitySoc: restoreUtilitySoc,
          batterySoc: restoreBatterySoc
        }
      );

      /*
       * Restore utility first.
       */

      const utilityResult = await writeConfig(
        "comebackUtilityModeSocPointUnderSBU",
        restoreUtilitySoc
      );

      /*
       * Restore battery second.
       */

      const batteryResult = await writeConfig(
        "comebackBatteryModeSocPoint",
        restoreBatterySoc
      );

      return res.status(200).json({
        ok: true,
        action: "restore",

        utilitySoc: restoreUtilitySoc,

        batterySoc: restoreBatterySoc,

        utilityResult,

        batteryResult,

        message:
          `Inverter SOC settings restored: ` +
          `Utility ${restoreUtilitySoc}%, ` +
          `Battery ${restoreBatterySoc}%.`
      });
    }

    return res.status(400).json({
      ok: false,
      error: `Unknown control action: ${action}`
    });
  } catch (error) {
    console.error(
      "SiSeli control error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error?.message ||
        "Unknown control error"
    });
  }
}