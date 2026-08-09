const DEVICE_ID = process.env.SISELI_DEVICE_ID;
const IOT_TOKEN = process.env.SISELI_IOT_TOKEN;

const SISELI_BASE_URL = "https://solar.siseli.com";

const DEFAULT_GRID_SOC = 22;
const DEFAULT_BATTERY_SOC = 35;

async function writeConfig(key, value) {
  const response = await fetch(
    `${SISELI_BASE_URL}/apis/remote/device/config/write?deviceId=${DEVICE_ID}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        "IOT-Time-Zone": "Asia/Singapore",
        "IOT-Token": IOT_TOKEN,
        Origin: "https://solar.siseli.com",
        Referer: "https://solar.siseli.com/"
      },
      body: JSON.stringify({
        id: DEVICE_ID,
        key,
        value: String(value)
      })
    }
  );

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
    throw new Error(
      `SiSeli rejected ${key}=${value} (${response.status})`
    );
  }

  return data;
}

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
      batterySoc,
      restoreDefaults
    } = req.body || {};

    if (!DEVICE_ID || !IOT_TOKEN) {
      throw new Error(
        "Missing SISELI_DEVICE_ID or SISELI_IOT_TOKEN environment variable."
      );
    }

    /*
     * =========================================================
     * START MANUAL GRID CHARGING
     * =========================================================
     */
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

      /*
       * The utility comeback threshold must be at or below
       * the current battery SOC.
       *
       * Example:
       *
       * Current SOC = 48%
       * Utility comeback = 48%
       * Battery comeback = 90%
       *
       * This forces the inverter to remain/use utility until
       * battery reaches the target point.
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

      /*
       * FIRST:
       * Set Comeback Utility Mode SOC.
       */
      const utilityResult = await writeConfig(
        "comebackUtilityModeSocPointUnderSBU",
        forcedUtilitySoc
      );

      /*
       * SECOND:
       * Set Comeback Battery Mode SOC.
       */
      const batteryResult = await writeConfig(
        "comebackBatteryModeSocPoint",
        forcedBatterySoc
      );

      /*
       * IMPORTANT:
       *
       * We deliberately do NOT immediately restore the defaults.
       *
       * If we restore:
       *
       * Utility = 22
       * Battery = 35
       *
       * immediately after writing 90%, the inverter would
       * never have a chance to perform the requested charging.
       */

      return res.status(200).json({
        ok: true,
        action: "startCharging",
        currentSoc: current,
        utilitySoc: forcedUtilitySoc,
        batterySoc: forcedBatterySoc,
        utilityResult,
        batteryResult,
        restoreDefaultsRequested: Boolean(restoreDefaults),
        message:
          `Grid charging configured: utility comeback ${forcedUtilitySoc}% ` +
          `and battery comeback ${forcedBatterySoc}%.`
      });
    }

    /*
     * =========================================================
     * RESTORE NORMAL SETTINGS
     * =========================================================
     */
    if (action === "restore") {
      const restoreUtilitySoc = Number.isFinite(Number(utilitySoc))
        ? Number(utilitySoc)
        : DEFAULT_GRID_SOC;

      const restoreBatterySoc = Number.isFinite(Number(batterySoc))
        ? Number(batterySoc)
        : DEFAULT_BATTERY_SOC;

      const utilityResult = await writeConfig(
        "comebackUtilityModeSocPointUnderSBU",
        restoreUtilitySoc
      );

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
        message: "Default SOC settings restored."
      });
    }

    return res.status(400).json({
      ok: false,
      error: `Unknown control action: ${action}`
    });
  } catch (error) {
    console.error("SiSeli control error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Unknown control error"
    });
  }
}