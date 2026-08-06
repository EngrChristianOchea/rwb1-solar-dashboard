// control.js

const BASE_URL = "https://solar.siseli.com/apis";

const DEVICE_ID = process.env.SISELI_DEVICE_ID;
const TOKEN = process.env.SISELI_TOKEN;

const defaultHeaders = {
    "accept": "application/json",
    "content-type": "application/json; charset=utf-8",
    "iot-time-zone": "Asia/Singapore",
    "iot-token": TOKEN
};

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

/**
 * Write any inverter configuration
 */
export async function writeConfig(key, value) {
    return api(
        `${BASE_URL}/remote/device/config/write?deviceId=${DEVICE_ID}`,
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
export async function getLatestState() {
    return api(
        `${BASE_URL}/deviceState/simple/state/latest/v1?deviceId=${DEVICE_ID}&dataSource=1`,
        {
            method: "GET"
        }
    );
}

/**
 * Battery CV Voltage
 */
export async function setBatteryCV(voltage) {
    return writeConfig(
        "setBatteryCVChargeVoltage",
        voltage
    );
}

/**
 * Float Voltage
 */
export async function setBatteryFloat(voltage) {
    return writeConfig(
        "setBatteryFloatChargeVoltage",
        voltage
    );
}

/**
 * Generic function for future settings
 */
export async function setValue(key, value) {
    return writeConfig(key, value);
}