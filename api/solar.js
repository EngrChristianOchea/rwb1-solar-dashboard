const SOLAR_URL = "https://solar.siseli.com/apis/deviceState/simple/energy/flow/v1";

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const match = String(value).match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractFlatValues(input, output = {}) {
  if (!input || typeof input !== "object") return output;

  if (Array.isArray(input)) {
    for (const item of input) extractFlatValues(item, output);
    return output;
  }

  const possibleName =
    input.name ||
    input.fieldName ||
    input.field ||
    input.label ||
    input.title ||
    input.key ||
    input.code;

  const possibleValue =
    input.value ??
    input.val ??
    input.data ??
    input.currentValue ??
    input.realValue ??
    input.displayValue;

  if (possibleName && possibleValue !== undefined && typeof possibleValue !== "object") {
    output[normalizeKey(possibleName)] = possibleValue;
  }

  for (const [key, value] of Object.entries(input)) {
    if (value !== null && typeof value !== "object") {
      output[normalizeKey(key)] = value;
    } else {
      extractFlatValues(value, output);
    }
  }

  return output;
}

function pickNumber(flat, keys) {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (flat[normalized] !== undefined) {
      const value = parseNumber(flat[normalized]);
      if (value !== null) return value;
    }
  }
  return null;
}

function pickText(flat, keys) {
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (flat[normalized] !== undefined) {
      return String(flat[normalized]);
    }
  }
  return null;
}

export default async function handler(req, res) {
  try {
    const IOT_TOKEN = process.env.IOT_TOKEN;
    const DEVICE_ID = process.env.DEVICE_ID;

    if (!IOT_TOKEN || !DEVICE_ID) {
      return res.status(500).json({
        ok: false,
        error: "Missing IOT_TOKEN or DEVICE_ID in Vercel environment variables."
      });
    }

    const url = new URL(SOLAR_URL);
    url.searchParams.set("deviceId", DEVICE_ID);
    url.searchParams.set("dataSource", "1");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Accept-Language": "en-US",
        "IOT-Time-Zone": "Asia/Singapore",
        "IOT-Token": IOT_TOKEN,
        "Referer": "https://solar.siseli.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const json = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "Solar API request failed.",
        details: json
      });
    }

    const flat = extractFlatValues(json);

    const solar = {
      timestamp: new Date().toISOString(),

      pv_power_w: pickNumber(flat, [
        "pv_power_w",
        "pv_power",
        "PV Power",
        "PV power",
        "solar_power",
        "solar power"
      ]),

      generation_power_kw: pickNumber(flat, [
        "generation_power_kw",
        "generation_power",
        "Generation Power"
      ]),

      battery_soc_percent: pickNumber(flat, [
        "battery_soc_percent",
        "battery_soc",
        "SOC",
        "Battery SOC",
        "bms_soc_percent",
        "BMS SOC"
      ]),

      battery_voltage_v: pickNumber(flat, [
        "battery_voltage_v",
        "battery_voltage",
        "Battery Voltage",
        "bms_battery_voltage_v"
      ]),

      battery_charging_current_a: pickNumber(flat, [
        "battery_charging_current_a",
        "charging_current",
        "Battery Charging Current"
      ]),

      battery_discharge_current_a: pickNumber(flat, [
        "battery_discharge_current_a",
        "discharge_current",
        "Battery Discharge Current"
      ]),

      load_power_kw: pickNumber(flat, [
        "load_power_kw",
        "load_power",
        "Load Power",
        "output_active_power",
        "active_power"
      ]),

      load_va: pickNumber(flat, [
        "load_va",
        "Load VA",
        "apparent_power"
      ]),

      load_percent: pickNumber(flat, [
        "load_percent",
        "Load Percent",
        "load_rate"
      ]),

      output_voltage_v: pickNumber(flat, [
        "output_voltage_v",
        "Output Voltage",
        "ac_output_voltage"
      ]),

      output_frequency_hz: pickNumber(flat, [
        "output_frequency_hz",
        "Output Frequency",
        "ac_output_frequency"
      ]),

      grid_voltage_v: pickNumber(flat, [
        "grid_voltage_v",
        "Grid Voltage",
        "input_voltage",
        "AC Input Voltage"
      ]),

      grid_frequency_hz: pickNumber(flat, [
        "grid_frequency_hz",
        "Grid Frequency",
        "input_frequency"
      ]),

      working_state: pickText(flat, [
        "working_state",
        "Working State",
        "inverter_state",
        "mode"
      ]),

      battery_state: pickText(flat, [
        "battery_state",
        "Battery State",
        "charge_state"
      ]),

      bms_cycles: pickNumber(flat, [
        "bms_cycles",
        "BMS Cycles",
        "battery_cycles"
      ]),

      bms_ambient_temp_c: pickNumber(flat, [
        "bms_ambient_temp_c",
        "BMS Ambient Temp",
        "ambient_temp"
      ]),

      bms_mos_temp_c: pickNumber(flat, [
        "bms_mos_temp_c",
        "BMS MOS Temp",
        "mos_temp"
      ])
    };

    return res.status(200).json({
      ok: true,
      solar,
      rawFlat: flat
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Unknown server error."
    });
  }
}