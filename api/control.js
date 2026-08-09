// api/control.js

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
// OPEN API SIGNING
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

  const decrypted = CryptoJS.AES.decrypt(
    encryptedSecret,
    key,
    {
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.ZeroPadding,
      iv
    }
  );

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


function makeOpenHeaders({
  url,
  method,
  bodyString
}) {
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
// LOGIN
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
      `Solar login returned non-JSON response: ${text.substring(0, 300)}`
    );
  }


  if (!response.ok || json.code !== 0) {
    throw new Error(
      json.message ||
      `Solar login failed (HTTP ${response.status})`
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
// TOKEN
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


  return await loginToSolarOfThings();
}


// ============================================================
// SOLAR API REQUEST
// ============================================================

async function solarRequest({
  path,
  method = "GET",
  body = null
}) {

  const token =
    await getValidToken();


  const url =
    `${BASE_URL}${path}`;


  const bodyString =
    body !== null
      ? JSON.stringify(body)
      : "";


  const openHeaders =
    makeOpenHeaders({
      url,
      method,
      bodyString
    });


  const response =
    await fetch(url, {

      method,

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

      body:
        method === "GET"
          ? undefined
          : bodyString
    });


  const text =
    await response.text();


  let json;

  try {
    json = JSON.parse(text);
  } catch {

    throw new Error(
      `Solar API returned non-JSON response (HTTP ${response.status}): ${text.substring(0, 300)}`
    );
  }


  if (!response.ok) {

    // Token may have expired.
    if (
      response.status === 401 ||
      response.status === 403
    ) {
      cachedToken = null;
      cachedTokenExpiry = 0;
    }

    throw new Error(
      json?.message ||
      `Solar API HTTP ${response.status}`
    );
  }


  if (
    json &&
    json.code !== undefined &&
    json.code !== 0
  ) {

    // Force re-login next time.
    if (
      json.code === 401 ||
      json.code === 403
    ) {
      cachedToken = null;
      cachedTokenExpiry = 0;
    }

    throw new Error(
      json.message ||
      "Solar API request failed."
    );
  }


  return json;
}


// ============================================================
// DEVICE CONFIG WRITE
// ============================================================

async function writeConfig(
  deviceId,
  key,
  value
) {

  if (!deviceId) {
    throw new Error(
      "Missing DEVICE_ID environment variable."
    );
  }


  if (!key) {
    throw new Error(
      "Missing configuration key."
    );
  }


  const path =
    `/remote/device/config/write?deviceId=${encodeURIComponent(
      deviceId
    )}`;


  return solarRequest({

    path,

    method: "POST",

    body: {

      id: deviceId,

      key,

      value
    }

  });
}


// ============================================================
// GET LATEST STATE
// ============================================================

async function getLatestState(deviceId) {

  if (!deviceId) {
    throw new Error(
      "Missing DEVICE_ID environment variable."
    );
  }


  const path =
    `/deviceState/simple/state/latest/v1` +
    `?deviceId=${encodeURIComponent(deviceId)}` +
    `&dataSource=1`;


  return solarRequest({
    path,
    method: "GET"
  });
}


// ============================================================
// BATTERY SETTINGS
// ============================================================

async function setBatteryCV(
  deviceId,
  voltage
) {

  return writeConfig(
    deviceId,
    "setBatteryCVChargeVoltage",
    voltage
  );
}


async function setBatteryFloat(
  deviceId,
  voltage
) {

  return writeConfig(
    deviceId,
    "setBatteryFloatChargeVoltage",
    voltage
  );
}


// ============================================================
// VERCEL HANDLER
// ============================================================

export default async function handler(
  req,
  res
) {

  try {

    // --------------------------------------------------------
    // Environment
    // --------------------------------------------------------

    const deviceId =
      process.env.DEVICE_ID;


    if (!deviceId) {

      return res.status(500).json({

        ok: false,

        error:
          "Missing DEVICE_ID environment variable."

      });

    }


    // --------------------------------------------------------
    // CORS
    // --------------------------------------------------------

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );


    if (req.method === "OPTIONS") {

      return res.status(200).json({
        ok: true
      });

    }


    // --------------------------------------------------------
    // GET
    //
    // Used for reading latest inverter state.
    // --------------------------------------------------------

    if (req.method === "GET") {

      const json =
        await getLatestState(deviceId);


      return res.status(200).json({

        ok: true,

        data: json?.data ?? json

      });

    }


    // --------------------------------------------------------
    // POST
    //
    // Used for inverter control.
    // --------------------------------------------------------

    if (req.method === "POST") {

      const body =
        req.body || {};


      const action =
        body.action;


      // ------------------------------------------------------
      // Set battery CV voltage
      // ------------------------------------------------------

      if (
        action ===
        "setBatteryCV"
      ) {

        const voltage =
          Number(body.voltage);


        if (
          !Number.isFinite(voltage)
        ) {

          return res.status(400).json({

            ok: false,

            error:
              "Invalid battery CV voltage."

          });

        }


        const result =
          await setBatteryCV(
            deviceId,
            voltage
          );


        return res.status(200).json({

          ok: true,

          action,

          voltage,

          result

        });

      }


      // ------------------------------------------------------
      // Set battery float voltage
      // ------------------------------------------------------

      if (
        action ===
        "setBatteryFloat"
      ) {

        const voltage =
          Number(body.voltage);


        if (
          !Number.isFinite(voltage)
        ) {

          return res.status(400).json({

            ok: false,

            error:
              "Invalid battery float voltage."

          });

        }


        const result =
          await setBatteryFloat(
            deviceId,
            voltage
          );


        return res.status(200).json({

          ok: true,

          action,

          voltage,

          result

        });

      }


      // ------------------------------------------------------
      // Generic configuration write
      // ------------------------------------------------------

      if (
        action ===
        "writeConfig"
      ) {

        const key =
          body.key;

        const value =
          body.value;


        if (!key) {

          return res.status(400).json({

            ok: false,

            error:
              "Missing configuration key."

          });

        }


        const result =
          await writeConfig(
            deviceId,
            key,
            value
          );


        return res.status(200).json({

          ok: true,

          action,

          key,

          value,

          result

        });

      }


      // ------------------------------------------------------
      // Unknown action
      // ------------------------------------------------------

      return res.status(400).json({

        ok: false,

        error:
          "Unknown control action.",

        availableActions: [

          "setBatteryCV",

          "setBatteryFloat",

          "writeConfig"

        ]

      });

    }


    // --------------------------------------------------------
    // Unsupported HTTP method
    // --------------------------------------------------------

    return res.status(405).json({

      ok: false,

      error:
        `Method ${req.method} not allowed.`

    });


  } catch (error) {

    console.error(
      "Solar control error:",
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