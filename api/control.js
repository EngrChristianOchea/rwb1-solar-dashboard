// api/control.js

const BASE_URL = "https://solar.siseli.com/apis";

const DEVICE_ID = process.env.DEVICE_ID;
const TOKEN = process.env.SISELI_TOKEN;

const defaultHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json; charset=utf-8",
  "IOT-Time-Zone": "Asia/Singapore",
  "IOT-Token": TOKEN,
  Origin: "https://solar.siseli.com",
  Referer: "https://solar.siseli.com/"
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
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Siseli API returned non-JSON response (${response.status}): ${text.slice(
        0,
        300
      )}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Siseli API HTTP ${response.status}`
    );
  }

  return data;
}

/**
 * Write inverter configuration
 */
export async function writeConfig(key, value) {
  if (!DEVICE_ID) {
    throw new Error("Missing DEVICE_ID environment variable.");
  }

  if (!TOKEN) {
    throw new Error("Missing SISELI_TOKEN environment variable.");
  }

  return api(
    `${BASE_URL}/remote/device/config/write?deviceId=${DEVICE_ID}`,
    {
      method: "POST",
      body: JSON.stringify({
        id: DEVICE_ID,
        key,
        value: String(value)
      })
    }
  );
}

/**
 * Read latest inverter state
 */
export async function getLatestState() {
  if (!DEVICE_ID) {
    throw new Error("Missing DEVICE_ID environment variable.");
  }

  return api(
    `${BASE_URL}/deviceState/simple/state/latest/v1?deviceId=${DEVICE_ID}&dataSource=1`,
    {
      method: "GET"
    }
  );
}

/**
 * Set maximum charging current
 */
export async function setMaxChargingCurrent(current) {
  return writeConfig(
    "setMaxChargingCurrent",
    current
  );
}

/**
 * Set Comeback Utility Mode SOC point
 *
 * This is the SOC threshold used to force/allow
 * utility/grid operation under SBU behavior.
 */
export async function setComebackUtilityMode(soc) {
  return writeConfig(
    "comebackUtilityModeSocPointUnderSBU",
    soc
  );
}

/**
 * Start manual grid charging
 *
 * currentSoc:
 *   Current battery SOC
 *
 * targetSoc:
 *   Desired SOC to finish charging
 *
 * chargingCurrent:
 *   Maximum charging current
 */
export async function startGridCharging({
  currentSoc,
  targetSoc,
  chargingCurrent = 60
}) {
  if (
    currentSoc === undefined ||
    targetSoc === undefined
  ) {
    throw new Error(
      "currentSoc and targetSoc are required."
    );
  }

  currentSoc = Number(currentSoc);
  targetSoc = Number(targetSoc);
  chargingCurrent = Number(chargingCurrent);

  if (
    !Number.isFinite(currentSoc) ||
    !Number.isFinite(targetSoc) ||
    !Number.isFinite(chargingCurrent)
  ) {
    throw new Error("Invalid charging parameters.");
  }

  if (targetSoc <= currentSoc) {
    throw new Error(
      `Target SOC (${targetSoc}%) must be higher than current SOC (${currentSoc}%).`
    );
  }

  /*
   * IMPORTANT:
   *
   * We deliberately set the comeback utility threshold
   * to the current SOC or slightly below it.
   *
   * Example:
   *
   * Battery = 42%
   * Target  = 90%
   *
   * Utility threshold = 42%
   * Battery mode SOC   = 90%
   *
   * This causes the inverter to use utility/grid and
   * continue until the target threshold is reached.
   */

  const utilityThreshold = Math.max(
    0,
    Math.floor(currentSoc)
  );

  const results = {};

  // 1. Force utility/grid operation at current SOC
  results.utilityMode = await setComebackUtilityMode(
    utilityThreshold
  );

  // 2. Set desired charging finish SOC
  results.targetSoc = await writeConfig(
    "comebackBatteryModeSocPointUnderSBU",
    targetSoc
  );

  // 3. Set charging current
  results.chargingCurrent = await setMaxChargingCurrent(
    chargingCurrent
  );

  return {
    ok: true,
    currentSoc,
    targetSoc,
    chargingCurrent,
    utilityThreshold,
    results
  };
}

/**
 * Stop / restore grid charging
 *
 * Set these values back to your normal operating values.
 */
export async function stopGridCharging({
  utilitySoc = 35,
  targetSoc = 90,
  chargingCurrent = 60
} = {}) {
  const results = {};

  results.utilityMode = await setComebackUtilityMode(
    utilitySoc
  );

  results.targetSoc = await writeConfig(
    "comebackBatteryModeSocPointUnderSBU",
    targetSoc
  );

  results.chargingCurrent = await setMaxChargingCurrent(
    chargingCurrent
  );

  return {
    ok: true,
    restored: {
      utilitySoc,
      targetSoc,
      chargingCurrent
    },
    results
  };
}

/**
 * Generic configuration writer
 */
export async function setValue(key, value) {
  return writeConfig(key, value);
}