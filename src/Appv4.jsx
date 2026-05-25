import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  Activity,
  Battery,
  Bolt,
  CalendarDays,
  CloudSun,
  Database,
  Gauge,
  Home,
  Moon,
  RefreshCcw,
  Settings,
  Sparkles,
  Sun,
  SunMedium,
  Thermometer,
  TrendingUp,
  Zap
} from "lucide-react";

const SETUP = {
  name: "RWB1 Solar Logger",
  locationName: "Cebu, Philippines",
  latitude: 10.2926208,
  longitude: 123.9783084,

  solarPanels: "4 × 620W solar panels",
  inverter: "48V hybrid off-grid inverter",
  battery: "48V / 200Ah LiFePO₄ battery",

  // 4 × 620W = 2.48kWp
  solarArrayKw: 2.48,
  defaultSolarHarvestEfficiency: 0.9,

  defaultBatteryCapacityKwh: 9.6,
  defaultReserveSocPercent: 20,
  defaultInverterEfficiency: 0.95,
  defaultElectricityRatePhp: 12
};

const WEATHER_CODES = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm"
};

const STORAGE_KEYS = {
  theme: "rwb1ThemeMode",
  savingsRecords: "rwb1SavingsRecordsV1",
  savingsSamples: "rwb1SavingsSamplesV1"
};

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatPeso(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `₱${Number(value).toFixed(2)}`;
}

function formatPowerKw(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${formatNumber(value, 3)} kW`;
}

function formatPowerW(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${formatNumber(value, 0)} W`;
}

function formatRuntime(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m} min`;
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage errors, usually private browsing or quota limits.
  }
}

function getPhilippinesDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

function getSolarIndex(psh) {
  const value = Number(psh || 0);
  if (value >= 6) return "Excellent";
  if (value >= 4.5) return "Good";
  if (value >= 3) return "Fair";
  if (value > 0) return "Low";
  return "--";
}

function getWeatherSuggestion(weather) {
  if (!weather || weather.length === 0) {
    return "Forecast data is still loading. Once available, battery usage suggestions will appear here.";
  }

  const tomorrow = weather[1] || weather[0];
  const solarIndex = getSolarIndex(tomorrow.psh);
  const rain = Number(tomorrow.rain || 0);
  const harvest = Number(tomorrow.expectedHarvestKwh || 0);
  const uv = Number(tomorrow.uvIndex || 0);
  const desc = WEATHER_CODES[tomorrow.code] || "forecasted weather";

  if (solarIndex === "Excellent" || solarIndex === "Good") {
    return `Tomorrow looks ${desc.toLowerCase()} with ${solarIndex.toLowerCase()} solar potential. PSH is around ${formatNumber(tomorrow.psh, 1)} hours and expected harvest is around ${formatNumber(harvest, 1)} kWh, so you can maximize daytime battery charging and shift heavier loads to sunny hours.`;
  }

  if (rain >= 60) {
    return `Rain chance tomorrow is high at ${formatNumber(rain, 0)}%. PSH is around ${formatNumber(tomorrow.psh, 1)} hours and expected harvest is only around ${formatNumber(harvest, 1)} kWh, so conserve battery overnight and avoid unnecessary heavy loads if solar charging is weak.`;
  }

  if (uv >= 8 && harvest >= 8) {
    return `Tomorrow has strong sun exposure with UV index around ${formatNumber(uv, 1)}. PSH is around ${formatNumber(tomorrow.psh, 1)} hours, so charging is likely good. Keep batteries/equipment away from hot areas and use daytime solar for larger loads.`;
  }

  return `Tomorrow's solar potential is ${solarIndex.toLowerCase()} with PSH around ${formatNumber(tomorrow.psh, 1)} hours and estimated harvest around ${formatNumber(harvest, 1)} kWh. Normal battery usage should be okay, but monitor SOC before running heavy loads at night.`;
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function TabButton({ active, icon, children, onClick }) {
  return (
    <button className={`tab-btn ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function WeatherCard({ day }) {
  const date = new Date(day.date);
  const dayName = date.toLocaleDateString("en-PH", { weekday: "short" });

  return (
    <div className="weather-card">
      <div className="weather-day">{dayName}</div>
      <div className="weather-date">
        {date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
      </div>
      <CloudSun size={30} />
      <div className="weather-temp">
        {Math.round(day.tMax)}° / {Math.round(day.tMin)}°
      </div>
      <div className="weather-desc">{WEATHER_CODES[day.code] || "Forecast"}</div>
      <div className="weather-rain">Rain: {day.rain ?? 0}%</div>
      <div className="weather-solar">PSH: {formatNumber(day.psh, 1)} hrs</div>
      <div className="weather-solar">Expected harvest: {formatNumber(day.expectedHarvestKwh, 1)} kWh</div>
      <div className="weather-solar">UV Index: {formatNumber(day.uvIndex, 1)}</div>
      <div className="weather-solar">Solar Index: {getSolarIndex(day.psh)}</div>
    </div>
  );
}

function LivePowerFlow({ solar }) {
  const pvPower = Number(solar?.pv_power_w ?? 0);
  const loadKw = Number(solar?.load_power_kw ?? 0);
  const soc = Number(solar?.battery_soc_percent ?? 0);
  const gridVoltage = Number(solar?.grid_voltage_v ?? 0);
  const batteryState = String(solar?.battery_state || "").toLowerCase();

  const isSolarActive = pvPower > 30;
  const isLoadActive = loadKw > 0.05;
  const isGridActive = gridVoltage > 50;
  const isCharging = batteryState.includes("charge") && !batteryState.includes("discharge");
  const isDischarging = batteryState.includes("discharge") || loadKw > 0.05;

  return (
    <div className="power-map-card">
      <div className="flow-title">Live Power Flow</div>

      <div className="power-map">
        <div className={`map-node map-pv ${isSolarActive ? "active solar-glow" : ""}`}>
          <span>PV Panel</span>
          <strong>{formatPowerW(pvPower)}</strong>
          <div className="map-icon"><Sun size={26} /></div>
        </div>

        <div className={`map-node map-grid ${isGridActive ? "active grid-glow" : ""}`}>
          <span>Power Grid</span>
          <strong>{formatNumber(gridVoltage, 0)} V</strong>
          <div className="map-icon"><Bolt size={26} /></div>
        </div>

        <div className={`map-node map-battery ${soc > 25 ? "active battery-glow" : "warning"}`}>
          <div className="map-icon"><Battery size={26} /></div>
          <span>Battery</span>
          <strong>{formatNumber(soc, 0)}%</strong>
        </div>

        <div className={`map-node map-load ${isLoadActive ? "active load-glow" : ""}`}>
          <div className="map-icon"><Home size={26} /></div>
          <span>Load</span>
          <strong>{formatPowerKw(loadKw)}</strong>
        </div>

        <div className="map-center active">
          <Zap size={30} />
          <span>Inverter</span>
          <strong>{solar?.working_state || "Online"}</strong>
        </div>

        <div className={`map-wire wire-left ${isSolarActive || isDischarging ? "active" : ""}`} />
        <div className={`map-wire wire-right ${isGridActive || isLoadActive ? "active" : ""}`} />
        <div className={`map-wire wire-down-left ${isCharging || isDischarging ? "active" : ""}`} />
        <div className={`map-wire wire-down-right ${isLoadActive ? "active" : ""}`} />

        <div className={`energy-dot dot-pv ${isSolarActive ? "active" : ""}`} />
        <div className={`energy-dot dot-load ${isLoadActive ? "active" : ""}`} />
        <div className={`energy-dot dot-battery ${isCharging || isDischarging ? "active" : ""}`} />
        <div className={`energy-dot dot-grid ${isGridActive ? "active" : ""}`} />
      </div>
    </div>
  );
}

function MoreInverterInfo({ solar }) {
  const inverterInfo = solar?.inverter_info || [];

  const fallbackInfo = [
    ["PV Power", formatPowerW(solar?.pv_power_w)],
    ["PV Voltage", `${formatNumber(solar?.pv_voltage_v, 1)} V`],
    ["Live Inverter Load", formatPowerKw(solar?.load_power_kw)],
    ["Load Percentage", `${formatNumber(solar?.load_percent, 0)}%`],
    ["Battery SOC", `${formatNumber(solar?.battery_soc_percent, 0)}%`],
    ["Battery Voltage", `${formatNumber(solar?.battery_voltage_v, 1)} V`],
    ["BMS Battery Voltage", `${formatNumber(solar?.bms_battery_voltage_v, 1)} V`],
    ["Battery Discharge Current", `${formatNumber(solar?.battery_discharge_current_a, 1)} A`],
    ["Battery Charging Current", `${formatNumber(solar?.battery_charging_current_a, 1)} A`],
    ["Output Voltage", `${formatNumber(solar?.output_voltage_v, 1)} V`],
    ["Output Frequency", `${formatNumber(solar?.output_frequency_hz, 1)} Hz`],
    ["Grid Voltage", `${formatNumber(solar?.grid_voltage_v, 1)} V`],
    ["Grid Frequency", `${formatNumber(solar?.grid_frequency_hz, 1)} Hz`],
    ["Working State", solar?.working_state || "--"],
    ["Battery State", solar?.battery_state || "--"],
    ["Grid State", solar?.grid_state || "--"],
    ["PV State", solar?.pv_state || "--"],
    ["Load State", solar?.load_state || "--"],
    ["BMS Ambient Temperature", `${formatNumber(solar?.bms_ambient_temp_c, 1)}°C`],
    ["BMS MOS Temperature", `${formatNumber(solar?.bms_mos_temp_c, 1)}°C`],
    ["NTC Max Temperature", `${formatNumber(solar?.ntc_max_temp_c, 1)}°C`]
  ];

  return (
    <section className="panel more-info-panel">
      <div className="panel-header">
        <div>
          <div className="panel-title">More Inverter Info</div>
          <p>
            {inverterInfo.length > 0
              ? "Full data list extracted from Solar of Things."
              : "Mapped inverter data currently returned by your API."}
          </p>
        </div>
      </div>

      {inverterInfo.length > 0 ? (
        <div className="info-table-wrap">
          <table className="info-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Value</th>
                <th>Unit</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {inverterInfo.map((item) => (
                <tr key={item.key}>
                  <td>{item.name}</td>
                  <td>{item.valueDisplay ?? item.value ?? "--"}</td>
                  <td>{item.unit || "--"}</td>
                  <td>{item.key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="more-info-grid">
          {fallbackInfo.map(([label, value]) => (
            <div className="more-info-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SavingsLineChart({ records }) {
  const chartRecords = records.slice(-30);
  const width = 680;
  const height = 260;
  const pad = 34;

  if (chartRecords.length === 0) {
    return <div className="empty-chart">No savings records yet. Keep the dashboard running and it will record after 8:00 AM PH time.</div>;
  }

  const maxKwh = Math.max(...chartRecords.map((item) => Number(item.dailyKwh || 0)), 1);
  const maxSavings = Math.max(...chartRecords.map((item) => Number(item.savingsPhp || 0)), 1);
  const xStep = chartRecords.length > 1 ? (width - pad * 2) / (chartRecords.length - 1) : 0;

  const pointFor = (item, index, type) => {
    const max = type === "kwh" ? maxKwh : maxSavings;
    const value = Number(type === "kwh" ? item.dailyKwh : item.savingsPhp) || 0;
    const x = pad + index * xStep;
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x},${y}`;
  };

  const kwhPoints = chartRecords.map((item, index) => pointFor(item, index, "kwh")).join(" ");
  const savingsPoints = chartRecords.map((item, index) => pointFor(item, index, "savings")).join(" ");

  return (
    <div className="chart-wrap">
      <svg className="savings-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Electricity savings line graph">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="chart-axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="chart-axis" />

        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={pad}
            y1={height - pad - ratio * (height - pad * 2)}
            x2={width - pad}
            y2={height - pad - ratio * (height - pad * 2)}
            className="chart-grid-line"
          />
        ))}

        <polyline points={kwhPoints} className="chart-line line-kwh" />
        <polyline points={savingsPoints} className="chart-line line-savings" />

        {chartRecords.map((item, index) => {
          const [kx, ky] = pointFor(item, index, "kwh").split(",").map(Number);
          const [sx, sy] = pointFor(item, index, "savings").split(",").map(Number);
          return (
            <g key={item.dateKey}>
              <circle cx={kx} cy={ky} r="4" className="chart-dot dot-kwh" />
              <circle cx={sx} cy={sy} r="4" className="chart-dot dot-savings" />
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span><i className="legend-kwh" /> Daily kWh</span>
        <span><i className="legend-savings" /> Daily Savings</span>
      </div>
    </div>
  );
}

function ElectricitySavingsPage({ solar }) {
  const [electricityRate, setElectricityRate] = useState(SETUP.defaultElectricityRatePhp);
  const [records, setRecords] = useState(() => readJsonStorage(STORAGE_KEYS.savingsRecords, []));
  const [samples, setSamples] = useState(() => readJsonStorage(STORAGE_KEYS.savingsSamples, {}));

  useEffect(() => {
    const loadKw = Number(solar?.load_power_kw);
    if (!Number.isFinite(loadKw) || loadKw < 0) return;

    const { dateKey, hour } = getPhilippinesDateParts();
    const currentSamples = readJsonStorage(STORAGE_KEYS.savingsSamples, {});
    const todaySamples = Array.isArray(currentSamples[dateKey]) ? currentSamples[dateKey] : [];

    const lastSample = todaySamples[todaySamples.length - 1];
    const now = Date.now();

    if (!lastSample || now - lastSample.timestamp > 5 * 60 * 1000) {
      todaySamples.push({ timestamp: now, loadKw });
      currentSamples[dateKey] = todaySamples.slice(-288);
      writeJsonStorage(STORAGE_KEYS.savingsSamples, currentSamples);
      setSamples(currentSamples);
    }

    if (hour >= 8) {
      const existingRecords = readJsonStorage(STORAGE_KEYS.savingsRecords, []);
      const alreadyRecorded = existingRecords.some((item) => item.dateKey === dateKey);
      const daySamples = currentSamples[dateKey] || [];

      if (!alreadyRecorded && daySamples.length > 0) {
        const averageLoadKw = daySamples.reduce((sum, item) => sum + Number(item.loadKw || 0), 0) / daySamples.length;
        const dailyKwh = averageLoadKw * 24;
        const savingsPhp = dailyKwh * Number(electricityRate || SETUP.defaultElectricityRatePhp);

        const nextRecords = [
          ...existingRecords,
          {
            dateKey,
            recordedAt: new Date().toISOString(),
            sampleCount: daySamples.length,
            averageLoadKw,
            dailyKwh,
            electricityRatePhp: Number(electricityRate || SETUP.defaultElectricityRatePhp),
            savingsPhp
          }
        ].slice(-60);

        writeJsonStorage(STORAGE_KEYS.savingsRecords, nextRecords);
        setRecords(nextRecords);
      } else {
        setRecords(existingRecords);
      }
    }
  }, [solar, electricityRate]);

  const savingsSummary = useMemo(() => {
    const totalKwh = records.reduce((sum, item) => sum + Number(item.dailyKwh || 0), 0);
    const totalSavings = records.reduce((sum, item) => sum + Number(item.savingsPhp || 0), 0);
    const averageDailyKwh = records.length ? totalKwh / records.length : 0;
    const averageDailySavings = records.length ? totalSavings / records.length : 0;
    const projection30DaySavings = averageDailySavings * 30;
    const projection30DayKwh = averageDailyKwh * 30;

    return {
      totalKwh,
      totalSavings,
      averageDailyKwh,
      averageDailySavings,
      projection30DaySavings,
      projection30DayKwh
    };
  }, [records]);

  const todayKey = getPhilippinesDateParts().dateKey;
  const todaySamples = samples[todayKey] || [];
  const liveLoadKw = Number(solar?.load_power_kw || 0);
  const liveDailyKwh = liveLoadKw * 24;
  const liveDailySavings = liveDailyKwh * Number(electricityRate || 0);

  return (
    <section className="panel savings-page">
      <div className="panel-header savings-header">
        <div>
          <div className="panel-title">Electricity Savings</div>
          <p>Average load is recorded once per day after 8:00 AM PH time when the dashboard is open.</p>
        </div>
        <label className="rate-control">
          Electricity Rate (₱/kWh)
          <input
            type="number"
            min="0"
            step="0.1"
            value={electricityRate}
            onChange={(event) => setElectricityRate(event.target.value)}
          />
        </label>
      </div>

      <div className="savings-summary-grid">
        <StatCard icon={<Zap size={24} />} label="Live Daily Energy" value={`${formatNumber(liveDailyKwh, 2)} kWh`} sub={`Based on current load: ${formatPowerKw(liveLoadKw)}`} />
        <StatCard icon={<Bolt size={24} />} label="Live Daily Savings" value={formatPeso(liveDailySavings)} sub={`At ₱${formatNumber(electricityRate, 2)}/kWh`} />
        <StatCard icon={<Activity size={24} />} label="Recorded Total kWh" value={`${formatNumber(savingsSummary.totalKwh, 2)} kWh`} sub={`${records.length} recorded day(s)`} />
        <StatCard icon={<TrendingUp size={24} />} label="30-Day Projection" value={formatPeso(savingsSummary.projection30DaySavings)} sub={`${formatNumber(savingsSummary.projection30DayKwh, 1)} kWh projected`} />
      </div>

      <SavingsLineChart records={records} />

      <div className="savings-table-wrap">
        <table className="info-table savings-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Average Load</th>
              <th>Total kWh</th>
              <th>Rate</th>
              <th>Savings</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan="6">No records yet. Current sample count today: {todaySamples.length}</td>
              </tr>
            ) : (
              records.slice().reverse().map((item) => (
                <tr key={item.dateKey}>
                  <td>{item.dateKey}</td>
                  <td>{formatPowerKw(item.averageLoadKw)}</td>
                  <td>{formatNumber(item.dailyKwh, 2)} kWh</td>
                  <td>₱{formatNumber(item.electricityRatePhp, 2)}</td>
                  <td>{formatPeso(item.savingsPhp)}</td>
                  <td>{item.sampleCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.theme) || "dark");
  const [solar, setSolar] = useState(null);
  const [weather, setWeather] = useState([]);
  const [solarError, setSolarError] = useState("");
  const [weatherError, setWeatherError] = useState("");
  const [loadingSolar, setLoadingSolar] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const [batteryCapacityKwh, setBatteryCapacityKwh] = useState(SETUP.defaultBatteryCapacityKwh);
  const [reserveSocPercent, setReserveSocPercent] = useState(SETUP.defaultReserveSocPercent);
  const [inverterEfficiency, setInverterEfficiency] = useState(SETUP.defaultInverterEfficiency);
  const [solarHarvestEfficiency, setSolarHarvestEfficiency] = useState(SETUP.defaultSolarHarvestEfficiency);
  const [useLiveLoad, setUseLiveLoad] = useState(true);
  const [manualLoadKw, setManualLoadKw] = useState("");

  useEffect(() => {
    document.body.classList.toggle("light-mode", theme === "light");
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  async function fetchSolar() {
    try {
      setLoadingSolar(true);
      setSolarError("");

      const response = await fetch("/api/solar", {
        cache: "no-store"
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Solar API failed.");
      }

      setSolar(data.solar);
      setLastRefresh(new Date());
    } catch (error) {
      setSolarError(error.message);
    } finally {
      setLoadingSolar(false);
    }
  }

  async function fetchWeather() {
    try {
      setWeatherError("");

      const params = new URLSearchParams({
        latitude: String(SETUP.latitude),
        longitude: String(SETUP.longitude),
        daily: [
          "weather_code",
          "temperature_2m_max",
          "temperature_2m_min",
          "precipitation_probability_max",
          "shortwave_radiation_sum",
          "uv_index_max"
        ].join(","),
        timezone: "Asia/Manila",
        forecast_days: "7"
      });

      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.reason || "Weather API failed.");
      }

      const days = data.daily.time.map((date, index) => {
        const shortwaveMjM2 = Number(data.daily.shortwave_radiation_sum[index] || 0);
        const psh = shortwaveMjM2 / 3.6;
        const expectedHarvestKwh = psh * SETUP.solarArrayKw * Number(solarHarvestEfficiency || SETUP.defaultSolarHarvestEfficiency);

        return {
          date,
          code: data.daily.weather_code[index],
          tMax: data.daily.temperature_2m_max[index],
          tMin: data.daily.temperature_2m_min[index],
          rain: data.daily.precipitation_probability_max[index],
          shortwaveMjM2,
          psh,
          uvIndex: data.daily.uv_index_max[index],
          expectedHarvestKwh
        };
      });

      setWeather(days);
    } catch (error) {
      setWeatherError(error.message);
    }
  }

  useEffect(() => {
    fetchSolar();
    fetchWeather();

    const timer = setInterval(fetchSolar, 30000);
    return () => clearInterval(timer);
  }, []);

  const activeLoadKw = useMemo(() => {
    if (useLiveLoad) return Number(solar?.load_power_kw);
    return Number(manualLoadKw);
  }, [useLiveLoad, solar, manualLoadKw]);

  const runtime = useMemo(() => {
    const soc = Number(solar?.battery_soc_percent);
    const loadKw = Number(activeLoadKw);
    const capacity = Number(batteryCapacityKwh);
    const reserve = Number(reserveSocPercent);
    const efficiency = Number(inverterEfficiency);

    if (
      !Number.isFinite(soc) ||
      !Number.isFinite(loadKw) ||
      !Number.isFinite(capacity) ||
      !Number.isFinite(reserve) ||
      !Number.isFinite(efficiency) ||
      loadKw <= 0 ||
      capacity <= 0 ||
      efficiency <= 0
    ) {
      return null;
    }

    const usableSoc = Math.max(soc - reserve, 0) / 100;
    const usableKwh = capacity * usableSoc * efficiency;

    return {
      usableKwh,
      hours: usableKwh / loadKw
    };
  }, [solar, activeLoadKw, batteryCapacityKwh, reserveSocPercent, inverterEfficiency]);

  const aiSuggestion = useMemo(() => getWeatherSuggestion(weather), [weather]);

  useEffect(() => {
    fetchWeather();
  }, [solarHarvestEfficiency]);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Solar IoT Dashboard</div>
          <h1>{SETUP.name}</h1>
          <p>Live solar logger data, weather forecast, battery runtime estimate, animated power flow, and savings tracking.</p>
          <div className="maker-credit">Made by Engr. Christian Louie Ethance Ochea, ECT</div>
        </div>

        <div className="hero-actions">
          <button className="refresh-btn" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={18} /> : <SunMedium size={18} />}
            {theme === "light" ? "Dark Mode" : "Light Mode"}
          </button>
          <button className="refresh-btn" onClick={fetchSolar} disabled={loadingSolar}>
            <RefreshCcw size={18} className={loadingSolar ? "spin" : ""} />
            Refresh
          </button>
        </div>
      </section>

      <nav className="tabs">
        <TabButton active={activePage === "dashboard"} icon={<Activity size={18} />} onClick={() => setActivePage("dashboard")}>Dashboard</TabButton>
        <TabButton active={activePage === "weather"} icon={<CloudSun size={18} />} onClick={() => setActivePage("weather")}>Weather Forecast</TabButton>
        <TabButton active={activePage === "savings"} icon={<TrendingUp size={18} />} onClick={() => setActivePage("savings")}>Electricity Savings</TabButton>
        <TabButton active={activePage === "more"} icon={<Database size={18} />} onClick={() => setActivePage("more")}>More Inverter Info</TabButton>
        <TabButton active={activePage === "setup"} icon={<Settings size={18} />} onClick={() => setActivePage("setup")}>Setup</TabButton>
      </nav>

      {solarError && <div className="error-box">Solar data error: {solarError}</div>}
      {weatherError && <div className="error-box">Weather error: {weatherError}</div>}

      {activePage === "dashboard" && (
        <>
          <section className="grid dashboard-grid">
            <div className="panel wide">
              <LivePowerFlow solar={solar} />
            </div>

            <div className="panel runtime-panel">
              <div className="panel-title">Battery Runtime Estimate</div>
              <div className="runtime-big">{runtime ? formatRuntime(runtime.hours) : "--"}</div>
              <p>Estimated time from current battery SOC down to <strong>{reserveSocPercent}%</strong> reserve.</p>

              <div className="runtime-meter">
                <div className="runtime-fill" style={{ width: `${Math.min(Math.max(Number(solar?.battery_soc_percent || 0), 0), 100)}%` }} />
              </div>

              <div className="runtime-details">
                <span>SOC: {formatNumber(solar?.battery_soc_percent, 0)}%</span>
                <span>Usable: {formatNumber(runtime?.usableKwh, 2)} kWh</span>
                <span>Live Inverter Load: {formatPowerKw(activeLoadKw)}</span>
              </div>

              <div className="runtime-controls">
                <label>
                  Live Inverter Load (kW)
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={useLiveLoad ? formatNumber(solar?.load_power_kw, 3) : manualLoadKw}
                    onChange={(event) => {
                      setUseLiveLoad(false);
                      setManualLoadKw(event.target.value);
                    }}
                  />
                </label>

                <label>
                  Current Battery Capacity (kWh)
                  <input type="number" min="0" step="0.1" value={batteryCapacityKwh} onChange={(event) => setBatteryCapacityKwh(event.target.value)} />
                </label>

                <button className="mini-btn" type="button" onClick={() => setUseLiveLoad(true)}>Use Live Solar Load</button>

                <label>
                  Reserve SOC (%)
                  <input type="number" min="0" max="100" step="1" value={reserveSocPercent} onChange={(event) => setReserveSocPercent(event.target.value)} />
                </label>

                <label>
                  Runtime Efficiency (%)
                  <input type="number" min="1" max="100" step="1" value={Math.round(Number(inverterEfficiency) * 100)} onChange={(event) => setInverterEfficiency(Number(event.target.value) / 100)} />
                </label>
              </div>
            </div>
          </section>

          <section className="stats-grid">
            <StatCard icon={<Sun size={24} />} label="PV Power" value={formatPowerW(solar?.pv_power_w)} sub="Current solar production" />
            <StatCard icon={<Home size={24} />} label="Live Inverter Load" value={formatPowerKw(solar?.load_power_kw)} sub={`${formatNumber(solar?.load_percent, 0)}% inverter load`} />
            <StatCard icon={<Battery size={24} />} label="Battery SOC" value={`${formatNumber(solar?.battery_soc_percent, 0)}%`} sub={`${formatNumber(solar?.battery_voltage_v, 1)} V battery`} />
            <StatCard icon={<Gauge size={24} />} label="AC Output" value={`${formatNumber(solar?.output_voltage_v, 1)} V`} sub={`${formatNumber(solar?.output_frequency_hz, 1)} Hz`} />
            <StatCard icon={<Activity size={24} />} label="Working State" value={solar?.working_state || "--"} sub={solar?.battery_state ? `Battery: ${solar.battery_state}` : "Inverter mode"} />
            <StatCard icon={<Thermometer size={24} />} label="BMS Temp" value={`${formatNumber(solar?.bms_ambient_temp_c, 1)}°C`} sub={`MOS: ${formatNumber(solar?.bms_mos_temp_c, 1)}°C`} />
          </section>
        </>
      )}

      {activePage === "weather" && (
        <section className="panel weather-page">
          <div className="panel-header">
            <div>
              <div className="panel-title">Weather Forecast</div>
              <p>{SETUP.locationName} • {SETUP.latitude}, {SETUP.longitude}</p>
            </div>
          </div>

          <div className="ai-suggestion-box">
            <Sparkles size={22} />
            <div>
              <strong>AI Suggestion</strong>
              <p>{aiSuggestion}</p>
            </div>
          </div>

          <div className="weather-summary-grid">
            <StatCard icon={<Sun size={24} />} label="Tomorrow Harvest" value={`${formatNumber(weather[1]?.expectedHarvestKwh, 1)} kWh`} sub={`PSH: ${formatNumber(weather[1]?.psh, 1)} hrs • ${weather[1] ? getSolarIndex(weather[1].psh) : "--"}`} />
            <StatCard icon={<CloudSun size={24} />} label="Tomorrow Weather" value={weather[1] ? WEATHER_CODES[weather[1].code] || "Forecast" : "--"} sub={`Rain: ${weather[1]?.rain ?? "--"}%`} />
            <StatCard icon={<Thermometer size={24} />} label="Tomorrow UV Index" value={formatNumber(weather[1]?.uvIndex, 1)} sub="Higher means stronger sun exposure" />
            <StatCard icon={<CalendarDays size={24} />} label="7-Day Harvest" value={`${formatNumber(weather.reduce((sum, day) => sum + Number(day.expectedHarvestKwh || 0), 0), 1)} kWh`} sub={`PSH × array kW × ${Math.round(Number(solarHarvestEfficiency) * 100)}% harvest efficiency`} />
          </div>

          <div className="weather-grid">
            {weather.map((day) => <WeatherCard key={day.date} day={day} />)}
          </div>
        </section>
      )}

      {activePage === "savings" && <ElectricitySavingsPage solar={solar} />}
      {activePage === "more" && <MoreInverterInfo solar={solar} />}

      {activePage === "setup" && (
        <section className="panel setup-panel">
          <div className="panel-title">Setup Info</div>
          <div className="setup-grid">
            <div><span>Solar Panels</span><strong>{SETUP.solarPanels}</strong></div>
            <div><span>Inverter</span><strong>{SETUP.inverter}</strong></div>
            <div><span>Battery</span><strong>{SETUP.battery}</strong></div>
            <div><span>Current Battery Capacity</span><strong>{batteryCapacityKwh} kWh</strong></div>
            <div><span>Reserve SOC</span><strong>{reserveSocPercent}%</strong></div>
            <div><span>Runtime Efficiency</span><strong>{Math.round(Number(inverterEfficiency) * 100)}%</strong></div>
            <div><span>Forecast Location</span><strong>{SETUP.latitude}, {SETUP.longitude}</strong></div>
            <div><span>Estimated Solar Array</span><strong>{SETUP.solarArrayKw} kWp</strong></div>
            <div><span>Solar Harvest Efficiency</span><strong>{Math.round(Number(solarHarvestEfficiency) * 100)}%</strong></div>
            <div>
              <span>Adjust Solar Harvest Efficiency</span>
              <strong>
                <input
                  className="inline-setup-input"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={Math.round(Number(solarHarvestEfficiency) * 100)}
                  onChange={(event) => setSolarHarvestEfficiency(Number(event.target.value) / 100)}
                />%
              </strong>
            </div>
            <div><span>Harvest Formula</span><strong>PSH × kWp × harvest efficiency</strong></div>
          </div>
        </section>
      )}

      <footer>
        <div>Made by Engr. Christian Louie Ethance Ochea, ECT</div>
        <div>
          Last refresh: {lastRefresh ? lastRefresh.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "medium" }) : "--"}
        </div>
      </footer>
    </main>
  );
}
