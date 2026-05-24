import dotenv from "dotenv";
import CryptoJS from "crypto-js";

dotenv.config({ path: ".env.local" });

let cachedToken = null;
let cachedTokenExpiry = 0;

const OPEN_APP_ID = "rBrTRfAPXz";
const ENCRYPTED_OPEN_APP_SECRET =
  "I4D0KRr2339z3pQ/at91V9BpFAOe54DaTafwSm6suIQ=";

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

function getField(fields, key, fallback = null) {
  const field = fields?.[key];

  if (!field) return fallback;

  if (field.value !== undefined && field.value !== null) {
    return field.value;
  }

  if (field.valueDisplay !== undefined && field.valueDisplay !== null) {
    return field.valueDisplay;
  }

  return fallback;
}

function getDisplay(fields, key, fallback = "--") {
  return fields?.[key]?.valueDisplay ?? fallback;
}

async function loginToSolarOfThings() {
  const account = process.env.SOT_ACCOUNT;
  const password = process.env.SOT_PASSWORD_HASH;

  if (!account || !password) {
    throw new Error(
      "Missing SOT_ACCOUNT or SOT_PASSWORD_HASH in environment variables."
    );
  }

  const url = "https://solar.siseli.com/apis/login/account";

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

  const json = await response.json();

  if (!response.ok || json.code !== 0) {
    throw new Error(json.message || "Solar of Things login failed.");
  }

  const accessToken = json?.data?.accessToken;
  const expiresAt = json?.data?.accessTokenWillExpiredAt;

  if (!accessToken) {
    throw new Error("Login succeeded, but no accessToken was returned.");
  }

  cachedToken = accessToken;
  cachedTokenExpiry = expiresAt
    ? new Date(expiresAt).getTime()
    : Date.now() + 60 * 60 * 1000;

  return accessToken;
}

async function getValidToken() {
  const now = Date.now();

  if (cachedToken && now < cachedTokenExpiry - 5 * 60 * 1000) {
    return cachedToken;
  }

  return await loginToSolarOfThings();
}

export default async function handler(req, res) {
  try {
    const deviceId = process.env.DEVICE_ID;

    if (!deviceId) {
      return res.status(500).json({
        ok: false,
        error: "Missing DEVICE_ID in environment variables."
      });
    }

    const token = await getValidToken();

    const url =
      `https://solar.siseli.com/apis/deviceState/simple/state/latest/v1` +
      `?deviceId=${deviceId}&dataSource=1`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "IOT-Time-Zone": "Asia/Singapore",
        "IOT-Token": token,
        Referer: "https://solar.siseli.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const json = await response.json();

    if (!response.ok || json.code !== 0) {
      cachedToken = null;
      cachedTokenExpiry = 0;

      return res.status(500).json({
        ok: false,
        error: json.message || "Failed to fetch solar data.",
        details: json
      });
    }

    const fields = json?.data?.fields || {};

    const solar = {
      raw_time: json?.data?.time,

      pv_power_w: Number(getField(fields, "pvInputPower", 0)),
      pv_voltage_v: Number(getField(fields, "pvInputVoltage", 0)),

      load_power_kw: Number(getField(fields, "acOutputActivePower", 0)),
      load_apparent_power_va: Number(getField(fields, "outputApparentPower", 0)),
      load_percent: Number(getField(fields, "loadPercentage", 0)),

      battery_soc_percent: Number(
        getField(fields, "batteryCapacity", getField(fields, "bmsBatterySOC", 0))
      ),
      battery_voltage_v: Number(getField(fields, "batteryVoltage", 0)),
      bms_battery_voltage_v: Number(getField(fields, "bmsBatteryVoltage", 0)),
      battery_discharge_current_a: Number(
        getField(fields, "batteryDischargeCurrent", 0)
      ),
      battery_charging_current_a: Number(
        getField(fields, "batteryChargingCurrent", 0)
      ),

      output_voltage_v: Number(getField(fields, "outputVoltage", 0)),
      output_frequency_hz: Number(getField(fields, "outputFrequency", 0)),

      grid_voltage_v: Number(getField(fields, "acInputVoltage", 0)),
      grid_frequency_hz: Number(getField(fields, "acInputFrequency", 0)),

      working_state: getDisplay(fields, "workingStates"),
      battery_state: getDisplay(fields, "batState"),
      grid_state: getDisplay(fields, "gridState"),
      pv_state: getDisplay(fields, "pvStatuss"),
      load_state: getDisplay(fields, "loadStatus"),

      bms_ambient_temp_c: Number(getField(fields, "bmsAmbientTemperature", 0)),
      bms_mos_temp_c: Number(getField(fields, "bmsMosTemperature", 0)),
      ntc_max_temp_c: Number(getField(fields, "ntcMaximumTemperature", 0))
    };

    return res.status(200).json({
      ok: true,
      solar
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}