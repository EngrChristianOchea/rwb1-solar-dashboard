// api/control.js

const BASE_URL = "https://solar.siseli.com/apis";

const DEVICE_ID = process.env.SISELI_DEVICE_ID;
const TOKEN = process.env.SISELI_TOKEN;

const defaultHeaders = {
  accept: "application/json",
  "content-type": "application/json; charset=utf-8",
  "iot-time-zone": "Asia/Singapore",
  "iot-token": TOKEN || ""
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Solar API returned non-JSON response: ${text.slice(0, 300)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Solar API HTTP ${response.status}`
    );
  }

  return data;
}

/**
 * Write inverter configuration
 */
async function writeConfig(key, value) {
  if (!DEVICE_ID) {
    throw new Error("Missing SISELI_DEVICE_ID environment variable.");
  }

  if (!TOKEN) {
    throw new Error("Missing SISELI_TOKEN environment variable.");
  }

  return api(
    `${BASE_URL}/remote/device/config/write?deviceId=${encodeURIComponent(
      DEVICE_ID
    )}`,
    {
      method: "POST",
      body: JSON.stringify({
        id: DEVICE_ID,
        key,
        value
      })
    }
  );
}

/**
 * Read latest inverter state
 */
async function getLatestState() {
  if (!DEVICE_ID) {
    throw new Error("Missing SISELI_DEVICE_ID environment variable.");
  }

  if (!TOKEN) {
    throw new Error("Missing SISELI_TOKEN environment variable.");
  }

  return api(
    `${BASE_URL}/deviceState/simple/state/latest/v1?deviceId=${encodeURIComponent(
      DEVICE_ID
    )}&dataSource=1`,
    {
      method: "GET"
    }
  );
}

/**
 * Battery CV Voltage
 */
async function setBatteryCV(voltage) {
  return writeConfig("setBatteryCVChargeVoltage", voltage);
}

/**
 * Float Voltage
 */
async function setBatteryFloat(voltage) {
  return writeConfig("setBatteryFloatChargeVoltage", voltage);
}

/**
 * Generic configuration writer
 */
async function setValue(key, value) {
  return writeConfig(key, value);
}

/**
 * Vercel API handler
 */
export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed. Use POST."
    });
  }

  try {
    if (!DEVICE_ID) {
      return res.status(500).json({
        ok: false,
        error: "Missing SISELI_DEVICE_ID environment variable."
      });
    }

    if (!TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "Missing SISELI_TOKEN environment variable."
      });
    }

    const {
      action,
      targetSoc,
      restoreDefaults = true
    } = req.body || {};

    console.log("Control request:", {
      action,
      targetSoc,
      restoreDefaults
    });

    /*
     * ---------------------------------------------------------
     * CHARGE
     * ---------------------------------------------------------
     *
     * IMPORTANT:
     * This currently demonstrates the configuration-write
     * mechanism. The exact Solar of Things configuration keys
     * for "utility/grid charging SOC" and "battery SOC target"
     * must match your inverter/API.
     */

    if (action === "charge") {
      const target = Number(targetSoc);

      if (!Number.isFinite(target) || target < 1 || target > 100) {
        return res.status(400).json({
          ok: false,
          error: "targetSoc must be between 1 and 100."
        });
      }

      /*
       * These are the configuration keys we are currently
       * using for the charging control.
       *
       * If your Solar of Things API uses different keys,
       * these two lines need to be changed.
       */

      const utilityResult = await setValue(
        "utilityChargeBatterySOC",
        target
      );

      const batteryResult = await setValue(
        "batteryChargeSOC",
        target
      );

      /*
       * Optional restore behavior.
       *
       * IMPORTANT:
       * We should NOT immediately restore the defaults here.
       *
       * If we did, the inverter would receive:
       *
       *     charge to 90%
       *     immediately restore to 22/35%
       *
       * which could cancel the intended charging behavior.
       *
       * The actual timed restoration should be implemented
       * separately after verifying the correct API behavior.
       */

      return res.status(200).json({
        ok: true,
        action: "charge",
        targetSoc: target,
        restoreDefaultsRequested: Boolean(restoreDefaults),
        utilityResult,
        batteryResult
      });
    }

    /*
     * ---------------------------------------------------------
     * RESTORE DEFAULTS
     * ---------------------------------------------------------
     */

    if (action === "restore") {
      const utilitySoc = Number(req.body.utilitySoc ?? 22);
      const batterySoc = Number(req.body.batterySoc ?? 35);

      const utilityResult = await setValue(
        "utilityChargeBatterySOC",
        utilitySoc
      );

      const batteryResult = await setValue(
        "batteryChargeSOC",
        batterySoc
      );

      return res.status(200).json({
        ok: true,
        action: "restore",
        utilitySoc,
        batterySoc,
        utilityResult,
        batteryResult
      });
    }

    /*
     * ---------------------------------------------------------
     * READ STATE
     * ---------------------------------------------------------
     */

    if (action === "state") {
      const state = await getLatestState();

      return res.status(200).json({
        ok: true,
        action: "state",
        state
      });
    }

    /*
     * ---------------------------------------------------------
     * SET GENERIC VALUE
     * ---------------------------------------------------------
     */

    if (action === "set") {
      const { key, value } = req.body || {};

      if (!key) {
        return res.status(400).json({
          ok: false,
          error: "Missing configuration key."
        });
      }

      const result = await setValue(key, value);

      return res.status(200).json({
        ok: true,
        action: "set",
        key,
        value,
        result
      });
    }

    return res.status(400).json({
      ok: false,
      error: `Unknown action: ${action || "undefined"}`
    });
  } catch (error) {
    console.error("Control API error:", error);

    return res.status(500).json({
      ok: false,
      error: error?.message || "Inverter control failed."
    });
  }
}