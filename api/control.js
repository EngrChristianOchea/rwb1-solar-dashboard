```javascript
import dotenv from "dotenv";
import CryptoJS from "crypto-js";

dotenv.config({ path: ".env.local" });

const SISELI_BASE_URL = "https://solar.siseli.com";

const OPEN_APP_ID = "rBrTRfAPXz";
const ENCRYPTED_OPEN_APP_SECRET =
  "I4D0KRr2339z3pQ/at91V9BpFAOe54DaTafwSm6suIQ=";

const DEFAULT_GRID_SOC = 22;
const DEFAULT_BATTERY_SOC = 35;

// These are the actual SiSeli configuration attributes
// confirmed from the browser requests.
const UTILITY_SOC_KEY = "comebackUtilityModeSocPointUnderSBU";
const BATTERY_SOC_KEY = "comebackBatteryModeSocPointUnderSBU";

let cachedToken = null;
let cachedTokenExpiry = 0;

/*
 * =========================================================
 * OPEN API SIGNING
 * Same authentication mechanism used by solar.js
 * =========================================================
 */

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
    signParams[key] = value;
  }

  signParams["IOT-Open-Body-Hash"] = getBodyHash(
    method,
    bodyString
  );

  signParams["IOT-Open-AppID"] = OPEN_APP_ID;
  signParams["IOT-Open-Nonce"] = nonce;

  const sortedParams = sortObject(signParams);

  const queryString = stringifyQueryNoEncode(
    sortedParams
  );

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

/*
 * =========================================================
 * LOGIN / DYNAMIC TOKEN
 * Same system used by solar.js
 * =========================================================
 */

async function loginToSolarOfThings() {
  const account = process.env.SOT_ACCOUNT;
  const password = process.env.SOT_PASSWORD_HASH;

  if (!account || !password) {
    throw new Error(
      "Missing SOT_ACCOUNT or SOT_PASSWORD_HASH in environment variables."
    );
  }

  const url =
    `${SISELI_BASE_URL}/apis/login/account`;

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
      "Content-Type":
        "application/json; charset=utf-8",

      ...openHeaders,

      "IOT-Time-Zone": "Asia/Singapore",
      "IOT-Token": "null",

      Origin:
        "https://solar.siseli.com",

      Referer:
        "https://solar.siseli.com/",

      "User-Agent":
        "Mozilla/5.0"
    },

    body: bodyString
  });

  const text = await response.text();

  let json;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Solar of Things login returned invalid JSON: ${text}`
    );
  }

  if (!response.ok || json?.code !== 0) {
    throw new Error(
      json?.message ||
        "Solar of Things login failed."
    );
  }

  const accessToken =
    json?.data?.accessToken;

  const expiresAt =
    json?.data?.accessTokenWillExpiredAt;

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
    "SiSeli dynamic IoT token acquired."
  );

  return accessToken;
}

async function getValidToken() {
  const now = Date.now();

  /*
   * Reuse the current token while it is still valid.
   *
   * Refresh 5 minutes before expiration.
   */
  if (
    cachedToken &&
    now < cachedTokenExpiry - 5 * 60 * 1000
  ) {
    return cachedToken;
  }

  return await loginToSolarOfThings();
}

/*
 * =========================================================
 * WRITE CONFIGURATION
 * =========================================================
 */

async function writeConfig(
  deviceId,
  key,
  value,
  retry = true
) {
  let token = await getValidToken();

  const url =
    `${SISELI_BASE_URL}` +
    `/apis/remote/device/config/write` +
    `?deviceId=${encodeURIComponent(deviceId)}`;

  const bodyString = JSON.stringify({
    id: deviceId,
    key,
    value: String(value)
  });

  const openHeaders = makeOpenHeaders({
    url,
    method: "POST",
    bodyString
  });

  let response = await fetch(url, {
    method: "POST",

    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US",
      "Content-Type":
        "application/json; charset=utf-8",

      ...openHeaders,

      "IOT-Time-Zone":
        "Asia/Singapore",

      "IOT-Token": token,

      Origin:
        "https://solar.siseli.com",

      Referer:
        "https://solar.siseli.com/",

      "User-Agent":
        "Mozilla/5.0"
    },

    body: bodyString
  });

  let text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  console.log("SiSeli config write:", {
    key,
    value,
    status: response.status,
    response: data
  });

  /*
   * If the token has expired unexpectedly,
   * clear it and retry ONCE with a fresh token.
   */
  if (
    retry &&
    (
      response.status === 401 ||
      response.status === 403 ||
      data?.code === 401 ||
      data?.code === 403
    )
  ) {
    console.log(
      "SiSeli token appears expired. Refreshing token..."
    );

    cachedToken = null;
    cachedTokenExpiry = 0;

    return await writeConfig(
      deviceId,
      key,
      value,
      false
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `SiSeli rejected ${key}=${value} (${response.status})`
    );
  }

  /*
   * Some SiSeli endpoints may return HTTP 200
   * but still report an API-level failure.
   */
  if (
    data &&
    typeof data === "object" &&
    data.code !== undefined &&
    data.code !== 0
  ) {
    throw new Error(
      data.message ||
        `SiSeli rejected configuration ${key}.`
    );
  }

  return data;
}

/*
 * =========================================================
 * WRITE BOTH SOC SETTINGS
 * =========================================================
 */

async function setSocSettings(
  deviceId,
  utilitySoc,
  batterySoc
) {
  const utilityValue = Math.min(
    Math.max(Math.floor(Number(utilitySoc)), 0),
    100
  );

  const batteryValue = Math.min(
    Math.max(Math.floor(Number(batterySoc)), 1),
    100
  );

  /*
   * IMPORTANT:
   *
   * Utility SOC is written first.
   * Battery SOC is written second.
   *
   * These are the exact attribute names confirmed
   * from the SiSeli web application.
   */

  const utilityResult = await writeConfig(
    deviceId,
    UTILITY_SOC_KEY,
    utilityValue
  );

  const batteryResult = await writeConfig(
    deviceId,
    BATTERY_SOC_KEY,
    batteryValue
  );

  return {
    utilitySoc: utilityValue,
    batterySoc: batteryValue,
    utilityResult,
    batteryResult
  };
}

/*
 * =========================================================
 * API HANDLER
 * =========================================================
 */

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const deviceId =
      process.env.DEVICE_ID;

    if (!deviceId) {
      return res.status(500).json({
        ok: false,
        error:
          "Missing DEVICE_ID in environment variables."
      });
    }

    const {
      action,
      currentSoc,
      utilitySoc,
      batterySoc
    } = req.body || {};

    /*
     * =====================================================
     * START MANUAL GRID CHARGING
     * =====================================================
     */

    if (action === "startCharging") {
      const current = Number(currentSoc);
      const requestedUtilitySoc =
        Number(utilitySoc);
      const target = Number(batterySoc);

      if (!Number.isFinite(current)) {
        throw new Error(
          "Invalid current SOC."
        );
      }

      if (!Number.isFinite(target)) {
        throw new Error(
          "Invalid target SOC."
        );
      }

      if (target <= current) {
        throw new Error(
          `Target SOC ${target}% is not above current SOC ${current}%.`
        );
      }

      /*
       * During manual charging:
       *
       * Utility comeback SOC = current SOC
       * Battery comeback SOC = target SOC
       *
       * Example:
       *
       * Current = 48%
       * Utility = 48%
       * Battery = 90%
       *
       * This allows the inverter to use utility
       * until the battery reaches the requested
       * target SOC.
       */

      const forcedUtilitySoc =
        Math.min(
          Math.floor(current),
          Number.isFinite(
            requestedUtilitySoc
          )
            ? Math.floor(
                requestedUtilitySoc
              )
            : DEFAULT_GRID_SOC
        );

      const forcedBatterySoc =
        Math.min(
          Math.max(
            Math.floor(target),
            1
          ),
          100
        );

      const result =
        await setSocSettings(
          deviceId,
          forcedUtilitySoc,
          forcedBatterySoc
        );

      return res.status(200).json({
        ok: true,

        action:
          "startCharging",

        currentSoc: current,

        utilitySoc:
          result.utilitySoc,

        batterySoc:
          result.batterySoc,

        utilityResult:
          result.utilityResult,

        batteryResult:
          result.batteryResult,

        message:
          `Manual grid charging configured. ` +
          `Utility comeback: ${result.utilitySoc}%. ` +
          `Target battery SOC: ${result.batterySoc}%.`
      });
    }

    /*
     * =====================================================
     * RESTORE DEFAULT SETTINGS
     * =====================================================
     */

    if (action === "restore") {
      const restoreUtilitySoc =
        Number.isFinite(
          Number(utilitySoc)
        )
          ? Number(utilitySoc)
          : DEFAULT_GRID_SOC;

      const restoreBatterySoc =
        Number.isFinite(
          Number(batterySoc)
        )
          ? Number(batterySoc)
          : DEFAULT_BATTERY_SOC;

      const result =
        await setSocSettings(
          deviceId,
          restoreUtilitySoc,
          restoreBatterySoc
        );

      return res.status(200).json({
        ok: true,

        action: "restore",

        utilitySoc:
          result.utilitySoc,

        batterySoc:
          result.batterySoc,

        utilityResult:
          result.utilityResult,

        batteryResult:
          result.batteryResult,

        message:
          `Default SOC settings restored. ` +
          `Utility comeback: ${result.utilitySoc}%. ` +
          `Battery comeback: ${result.batterySoc}%.`
      });
    }

    /*
     * =====================================================
     * UNKNOWN ACTION
     * =====================================================
     */

    return res.status(400).json({
      ok: false,
      error:
        `Unknown control action: ${action}`
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
```
