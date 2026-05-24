import { useEffect, useMemo, useState } from "react";
import {
  Battery,
  Bolt,
  CloudSun,
  Home,
  RefreshCcw,
  Sun,
  Zap,
  Gauge,
  Thermometer,
  Activity
} from "lucide-react";

const SETUP = {
  name: "RWB1 Solar Logger",
  locationName: "Cebu, Philippines",
  latitude: 10.3157,
  longitude: 123.8854,

  solarPanels: "4 × 620W solar panels",
  inverter: "48V hybrid off-grid inverter",
  battery: "48V / 100Ah LiFePO₄ battery",

  // Change this to your real usable battery size.
  // Example:
  // 48V × 100Ah = 4.8kWh
  // 51.2V × 100Ah = 5.12kWh
  batteryCapacityKwh: 5.12,

  reserveSocPercent: 25,
  inverterEfficiency: 0.9
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

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatPowerKw(value) {
  if (value === null || value === undefined) return "--";
  return `${formatNumber(value, 3)} kW`;
}

function formatPowerW(value) {
  if (value === null || value === undefined) return "--";
  return `${formatNumber(value, 0)} W`;
}

function formatRuntime(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m} min`;
  return `${h} hr ${m} min`;
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
      <div className="weather-solar">
        Sun energy: {formatNumber(day.sunKwh, 1)} kWh/m²
      </div>
    </div>
  );
}

function FlowAnimation({ solar }) {
  const pvPower = solar?.pv_power_w ?? 0;
  const loadKw = solar?.load_power_kw ?? 0;
  const soc = solar?.battery_soc_percent ?? 0;
  const gridVoltage = solar?.grid_voltage_v ?? 0;

  const isSolarActive = pvPower > 30;
  const isLoadActive = loadKw > 0.05;
  const isGridActive = gridVoltage > 50;

  return (
    <div className="flow-card">
      <div className="flow-title">Live Power Flow</div>

      <div className="flow-diagram">
        <div className={`flow-node solar ${isSolarActive ? "active" : ""}`}>
          <Sun size={34} />
          <span>Solar</span>
          <strong>{formatPowerW(pvPower)}</strong>
        </div>

        <div className={`flow-line ${isSolarActive ? "active" : ""}`} />

        <div className="flow-node inverter active">
          <Zap size={34} />
          <span>Inverter</span>
          <strong>{solar?.working_state || "Online"}</strong>
        </div>

        <div className={`flow-line ${isLoadActive ? "active" : ""}`} />

        <div className={`flow-node load ${isLoadActive ? "active" : ""}`}>
          <Home size={34} />
          <span>Load</span>
          <strong>{formatPowerKw(loadKw)}</strong>
        </div>
      </div>

      <div className="flow-diagram secondary">
        <div className={`flow-node battery ${soc > 25 ? "active" : "warning"}`}>
          <Battery size={34} />
          <span>Battery</span>
          <strong>{formatNumber(soc, 0)}%</strong>
        </div>

        <div className={`flow-line vertical ${soc > 25 ? "active" : ""}`} />

        <div className={`flow-node grid ${isGridActive ? "active" : ""}`}>
          <Bolt size={34} />
          <span>Grid</span>
          <strong>{formatNumber(gridVoltage, 0)} V</strong>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [solar, setSolar] = useState(null);
  const [weather, setWeather] = useState([]);
  const [solarError, setSolarError] = useState("");
  const [weatherError, setWeatherError] = useState("");
  const [loadingSolar, setLoadingSolar] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

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
          "shortwave_radiation_sum"
        ].join(","),
        timezone: "Asia/Manila",
        forecast_days: "7"
      });

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.reason || "Weather API failed.");
      }

      const days = data.daily.time.map((date, index) => ({
        date,
        code: data.daily.weather_code[index],
        tMax: data.daily.temperature_2m_max[index],
        tMin: data.daily.temperature_2m_min[index],
        rain: data.daily.precipitation_probability_max[index],
        sunKwh: data.daily.shortwave_radiation_sum[index]
      }));

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

  const runtime = useMemo(() => {
    const soc = Number(solar?.battery_soc_percent);
    const loadKw = Number(solar?.load_power_kw);

    if (!Number.isFinite(soc) || !Number.isFinite(loadKw) || loadKw <= 0) {
      return null;
    }

    const usableSoc = Math.max(soc - SETUP.reserveSocPercent, 0) / 100;
    const usableKwh =
      SETUP.batteryCapacityKwh * usableSoc * SETUP.inverterEfficiency;

    return {
      usableKwh,
      hours: usableKwh / loadKw
    };
  }, [solar]);

  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Solar IoT Dashboard</div>
          <h1>{SETUP.name}</h1>
          <p>
            Live solar logger data, weather forecast, battery runtime estimate,
            and animated power flow.
          </p>
        </div>

        <button className="refresh-btn" onClick={fetchSolar} disabled={loadingSolar}>
          <RefreshCcw size={18} className={loadingSolar ? "spin" : ""} />
          Refresh
        </button>
      </section>

      {solarError && (
        <div className="error-box">
          Solar data error: {solarError}
        </div>
      )}

      {weatherError && (
        <div className="error-box">
          Weather error: {weatherError}
        </div>
      )}

      <section className="grid dashboard-grid">
        <div className="panel wide">
          <FlowAnimation solar={solar} />
        </div>

        <div className="panel runtime-panel">
          <div className="panel-title">Battery Runtime Estimate</div>

          <div className="runtime-big">
            {runtime ? formatRuntime(runtime.hours) : "--"}
          </div>

          <p>
            Estimated time from current battery SOC down to{" "}
            <strong>{SETUP.reserveSocPercent}%</strong> reserve.
          </p>

          <div className="runtime-meter">
            <div
              className="runtime-fill"
              style={{
                width: `${Math.min(
                  Math.max(Number(solar?.battery_soc_percent || 0), 0),
                  100
                )}%`
              }}
            />
          </div>

          <div className="runtime-details">
            <span>SOC: {formatNumber(solar?.battery_soc_percent, 0)}%</span>
            <span>Usable: {formatNumber(runtime?.usableKwh, 2)} kWh</span>
            <span>Load: {formatPowerKw(solar?.load_power_kw)}</span>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          icon={<Sun size={24} />}
          label="PV Power"
          value={formatPowerW(solar?.pv_power_w)}
          sub="Current solar production"
        />

        <StatCard
          icon={<Home size={24} />}
          label="Load Power"
          value={formatPowerKw(solar?.load_power_kw)}
          sub={`${formatNumber(solar?.load_percent, 0)}% inverter load`}
        />

        <StatCard
          icon={<Battery size={24} />}
          label="Battery SOC"
          value={`${formatNumber(solar?.battery_soc_percent, 0)}%`}
          sub={`${formatNumber(solar?.battery_voltage_v, 1)} V battery`}
        />

        <StatCard
          icon={<Gauge size={24} />}
          label="AC Output"
          value={`${formatNumber(solar?.output_voltage_v, 1)} V`}
          sub={`${formatNumber(solar?.output_frequency_hz, 1)} Hz`}
        />

        <StatCard
          icon={<Activity size={24} />}
          label="Working State"
          value={solar?.working_state || "--"}
          sub={solar?.battery_state ? `Battery: ${solar.battery_state}` : "Inverter mode"}
        />

        <StatCard
          icon={<Thermometer size={24} />}
          label="BMS Temp"
          value={`${formatNumber(solar?.bms_ambient_temp_c, 1)}°C`}
          sub={`MOS: ${formatNumber(solar?.bms_mos_temp_c, 1)}°C`}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">7-Day Weather Forecast</div>
            <p>{SETUP.locationName}</p>
          </div>
        </div>

        <div className="weather-grid">
          {weather.map((day) => (
            <WeatherCard key={day.date} day={day} />
          ))}
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title">Setup Info</div>

        <div className="setup-grid">
          <div>
            <span>Solar Panels</span>
            <strong>{SETUP.solarPanels}</strong>
          </div>
          <div>
            <span>Inverter</span>
            <strong>{SETUP.inverter}</strong>
          </div>
          <div>
            <span>Battery</span>
            <strong>{SETUP.battery}</strong>
          </div>
          <div>
            <span>Battery Capacity</span>
            <strong>{SETUP.batteryCapacityKwh} kWh</strong>
          </div>
          <div>
            <span>Reserve SOC</span>
            <strong>{SETUP.reserveSocPercent}%</strong>
          </div>
          <div>
            <span>Runtime Efficiency</span>
            <strong>{Math.round(SETUP.inverterEfficiency * 100)}%</strong>
          </div>
        </div>
      </section>

      <footer>
        Last refresh:{" "}
        {lastRefresh
          ? lastRefresh.toLocaleString("en-PH", {
              dateStyle: "medium",
              timeStyle: "medium"
            })
          : "--"}
      </footer>
    </main>
  );
}