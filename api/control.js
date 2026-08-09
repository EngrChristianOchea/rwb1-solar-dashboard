import dotenv from "dotenv";
import CryptoJS from "crypto-js";

dotenv.config({ path: ".env.local" });

const SISELI_BASE_URL = "https://solar.siseli.com";

const DEFAULT_GRID_SOC = 22;
const DEFAULT_BATTERY_SOC = 35;

let cachedToken = null;
let cachedTokenExpiry = 0;

// Same SISELI open API credentials used by solar.js
const OPEN_APP_ID = "rBrTRfAPXz";

const ENCRYPTED_OPEN_APP_SECRET =
  "I4D0KRr2339z3pQ/at91V9BpFAOe54DaTafwSm6suIQ=";


/*
=========================================================
SISELI OPEN API SIGNING
=========================================================
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

  signParams["IOT-Open-AppID"] = OPEN_APP_ID;
  signParams["IOT-Open-Nonce"] = nonce;

  const sortedParams = sortObject(signParams);

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


/*
=========================================================
LOGIN
=========================================================
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

  const openHeaders =
    makeOpenHeaders({
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

  const json =
    await response.json();

  if (!response.ok || json.code !== 0) {

    throw new Error(
      json.message ||
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

  cachedToken =
    accessToken;

  cachedTokenExpiry =
    expiresAt
      ? new Date(expiresAt).getTime()
      : Date.now() + 60 * 60 * 1000;

  return accessToken;
}


/*
=========================================================
GET VALID TOKEN
=========================================================
*/

async function getValidToken() {

  const now = Date.now();

  if (
    cachedToken &&
    now <
      cachedTokenExpiry -
        5 * 60 * 1000
  ) {

    return cachedToken;

  }

  return await loginToSolarOfThings();
}


/*
=========================================================
DEVICE ID
=========================================================
*/

function getDeviceId() {

  const deviceId =
    process.env.DEVICE_ID;

  if (!deviceId) {

    throw new Error(
      "Missing DEVICE_ID in environment variables."
    );

  }

  return deviceId;
}


/*
=========================================================
WRITE CONFIG
=========================================================
*/

async function writeConfig(key, value) {

  const deviceId =
    getDeviceId();

  const token =
    await getValidToken();

  const url =
    `${SISELI_BASE_URL}` +
    `/apis/remote/device/config/write` +
    `?deviceId=${deviceId}`;

  const bodyString =
    JSON.stringify({

      id: deviceId,

      key,

      value: String(value)

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

        Accept:
          "application/json",

        "Accept-Language":
          "en-US",

        "Content-Type":
          "application/json; charset=utf-8",

        ...openHeaders,

        "IOT-Time-Zone":
          "Asia/Singapore",

        "IOT-Token":
          token,

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

  let data = null;

  try {

    data =
      text
        ? JSON.parse(text)
        : null;

  } catch {

    data = text;

  }


  console.log(
    "SiSeli WRITE",
    {
      key,
      value,
      status:
        response.status,
      response: data
    }
  );


  /*
  If token expired unexpectedly,
  clear it so the next request
  performs a fresh login.
  */

  if (
    response.status === 401 ||
    response.status === 403
  ) {

    cachedToken = null;
    cachedTokenExpiry = 0;

    throw new Error(
      `SiSeli authentication failed while writing ${key}.`
    );

  }


  if (!response.ok) {

    throw new Error(
      `SiSeli rejected ${key}=${value} ` +
      `(${response.status})`
    );

  }


  /*
  Some SISELI endpoints return HTTP 200
  but still report an application-level error.
  */

  if (
    data &&
    typeof data === "object" &&
    data.code !== undefined &&
    data.code !== 0
  ) {

    throw new Error(
      data.message ||
      `SiSeli rejected ${key}=${value}`
    );

  }


  return data;

}


/*
=========================================================
HANDLER
=========================================================
*/

export default async function handler(req, res) {

  if (req.method !== "POST") {

    return res.status(405).json({

      ok: false,

      error:
        "Method not allowed"

    });

  }


  try {

    const {

      action,

      currentSoc,

      utilitySoc,

      batterySoc,

      restoreDefaults

    } = req.body || {};


    /*
    =====================================================
    START MANUAL GRID CHARGING
    =====================================================
    */

    if (
      action ===
      "startCharging"
    ) {

      const current =
        Number(currentSoc);

      const requestedUtilitySoc =
        Number(utilitySoc);

      const target =
        Number(batterySoc);


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
      IMPORTANT:

      Comeback Utility Mode must be
      <= current SOC.

      Example:

      Current SOC = 48%
      Utility = 48%
      Battery = 90%

      This causes utility charging
      until the battery reaches 90%.
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
            : Math.floor(current)

        );


      const forcedBatterySoc =
        Math.min(

          Math.max(
            Math.floor(target),
            1
          ),

          100

        );


      /*
      STEP 1
      Set Comeback Utility Mode
      */

      console.log(
        "Setting utility comeback:",
        forcedUtilitySoc
      );


      const utilityResult =
        await writeConfig(

          "comebackUtilityModeSocPointUnderSBU",

          forcedUtilitySoc

        );


      /*
      STEP 2
      Set Comeback Battery Mode
      */

      console.log(
        "Setting battery comeback:",
        forcedBatterySoc
      );


      const batteryResult =
        await writeConfig(

          "comebackBatteryModeSocPoint",

          forcedBatterySoc

        );


      /*
      DO NOT restore defaults here.

      The inverter needs to remain configured
      with the temporary values so it can
      actually perform the grid charging.
      */

      return res.status(200).json({

        ok: true,

        action:
          "startCharging",

        currentSoc:
          current,

        utilitySoc:
          forcedUtilitySoc,

        batterySoc:
          forcedBatterySoc,

        utilityResult,

        batteryResult,

        restoreDefaultsRequested:
          Boolean(restoreDefaults),

        message:
          `Grid charging configured: ` +
          `Utility comeback ${forcedUtilitySoc}% ` +
          `→ Battery comeback ${forcedBatterySoc}%.`

      });

    }


    /*
    =====================================================
    RESTORE NORMAL SETTINGS
    =====================================================
    */

    if (
      action ===
      "restore"
    ) {

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


      const utilityResult =
        await writeConfig(

          "comebackUtilityModeSocPointUnderSBU",

          restoreUtilitySoc

        );


      const batteryResult =
        await writeConfig(

          "comebackBatteryModeSocPoint",

          restoreBatterySoc

        );


      return res.status(200).json({

        ok: true,

        action:
          "restore",

        utilitySoc:
          restoreUtilitySoc,

        batterySoc:
          restoreBatterySoc,

        utilityResult,

        batteryResult,

        message:
          "Default SOC settings restored."

      });

    }


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
        error.message ||
        "Unknown control error"

    });

  }

}