import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  Activity,
  Battery,
  Bolt,
  CalendarDays,
  CloudSun,
  Gauge,
  Home,
  RefreshCcw,
  Settings,
  Sparkles,
  Sun,
  Thermometer,
  Zap
} from "lucide-react";

const SETUP = {
  name: "RWB1 Solar Logger",
  locationName: "Cebu, Philippines",

  // Specific Open-Meteo location requested:
  // @10.2926208,123.9783084,15z
  latitude: 10.2926208,
  longitude: 123.9783084,

  solarPanels: "4 × 620W solar panels",
  inverter: "48V hybrid off-grid inverter",
  battery: "48V / 200Ah LiFePO₄ battery",

  // Used for estimated harvest from weather forecast.
  // 4 × 620W = 2.48kWp
  solarArrayKw: 2.48,
  harvestEfficiency: 0.75,

  // Dynamic runtime defaults requested.
  defaultBatteryCapacityKwh: 9.6,
  defaultReserveSocPercent: 20,
  defaultInverterEfficiency: 0.95
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

function getSolarIndex(shortwaveKwh) {
  const value = Number(shortwaveKwh || 0);
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
  const solarIndex = getSolarIndex(tomorrow.sunKwh);
  const rain = Number(tomorrow.rain || 0);
  const harvest = Number(tomorrow.expectedHarvestKwh || 0);
  const uv = Number(tomorrow.uvIndex || 0);
  const desc = WEATHER_CODES[tomorrow.code] || "forecasted weather";

  if (solarIndex === "Excellent" || solarIndex === "Good") {
    return `Tomorrow looks ${desc.toLowerCase()} with ${solarIndex.toLowerCase()} solar potential. Expected harvest is around ${formatNumber(harvest, 1)} kWh, so you can maximize daytime battery charging and shift heavier loads to sunny hours.`;
  }

  if (rain >= 60) {
    return `Rain chance tomorrow is high at ${formatNumber(rain, 0)}%. Expected harvest is only around ${formatNumber(harvest, 1)} kWh, so conserve battery overnight and avoid unnecessary heavy loads if solar charging is weak.`;
  }

  if (uv >= 8 && harvest >= 8) {
    return `Tomorrow has strong sun exposure with UV index around ${formatNumber(uv, 1)}. Charging is likely good, but avoid placing batteries/equipment in hot areas and use daytime solar for larger loads.`;
  }

  return `Tomorrow's solar potential is ${solarIndex.toLowerCase()} with estimated harvest around ${formatNumber(harvest, 1)} kWh. Normal battery usage should be okay, but monitor SOC before running heavy loads at night.`;
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
      <div className="weather-solar">Solar energy: {formatNumber(day.sunKwh, 1)} kWh/m²</div>
      <div className="weather-solar">Expected harvest: {formatNumber(day.expectedHarvestKwh, 1)} kWh</div>
      <div className="weather-solar">UV Index: {formatNumber(day.uvIndex, 1)}</div>
      <div className="weather-solar">Solar Index: {getSolarIndex(day.sunKwh)}</div>
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
  const [activePage, setActivePage] = useState("dashboard");
  const [solar, setSolar] = useState(null);
  const [weather, setWeather] = useState([]);
  const [solarError, setSolarError] = useState("");
  const [weatherError, setWeatherError] = useState("");
  const [loadingSolar, setLoadingSolar] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const [batteryCapacityKwh, setBatteryCapacityKwh] = useState(SETUP.defaultBatteryCapacityKwh);
  const [reserveSocPercent, setReserveSocPercent] = useState(SETUP.defaultReserveSocPercent);
  const [inverterEfficiency, setInverterEfficiency] = useState(SETUP.defaultInverterEfficiency);

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

      const response = await fetch(
        `https://api.open-meteo.com/v1/forecast?${params.toString()}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.reason || "Weather API failed.");
      }

      const days = data.daily.time.map((date, index) => {
        const sunKwh = data.daily.shortwave_radiation_sum[index];
        const expectedHarvestKwh = Number(sunKwh || 0) * SETUP.solarArrayKw * SETUP.harvestEfficiency;

        return {
          date,
          code: data.daily.weather_code[index],
          tMax: data.daily.temperature_2m_max[index],
          tMin: data.daily.temperature_2m_min[index],
          rain: data.daily.precipitation_probability_max[index],
          sunKwh,
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

  const runtime = useMemo(() => {
    const soc = Number(solar?.battery_soc_percent);
    const loadKw = Number(solar?.load_power_kw);
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
  }, [solar, batteryCapacityKwh, reserveSocPercent, inverterEfficiency]);

  const aiSuggestion = useMemo(() => getWeatherSuggestion(weather), [weather]);

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
          <div className="maker-credit">Made by Engr. Christian Louie Ethance Ochea, ECT</div>
        </div>

        <button className="refresh-btn" onClick={fetchSolar} disabled={loadingSolar}>
          <RefreshCcw size={18} className={loadingSolar ? "spin" : ""} />
          Refresh
        </button>
      </section>

      <nav className="tabs">
        <TabButton
          active={activePage === "dashboard"}
          icon={<Activity size={18} />}
          onClick={() => setActivePage("dashboard")}
        >
          Dashboard
        </TabButton>
        <TabButton
          active={activePage === "weather"}
          icon={<CloudSun size={18} />}
          onClick={() => setActivePage("weather")}
        >
          Weather Forecast
        </TabButton>
        <TabButton
          active={activePage === "setup"}
          icon={<Settings size={18} />}
          onClick={() => setActivePage("setup")}
        >
          Setup
        </TabButton>
      </nav>

      {solarError && <div className="error-box">Solar data error: {solarError}</div>}
      {weatherError && <div className="error-box">Weather error: {weatherError}</div>}

      {activePage === "dashboard" && (
        <>
          <section className="grid dashboard-grid">
            <div className="panel wide">
              <FlowAnimation solar={solar} />
            </div>

            <div className="panel runtime-panel">
              <div className="panel-title">Battery Runtime Estimate</div>

              <div className="runtime-big">{runtime ? formatRuntime(runtime.hours) : "--"}</div>

              <p>
                Estimated time from current battery SOC down to <strong>{reserveSocPercent}%</strong> reserve.
              </p>

              <div className="runtime-meter">
                <div
                  className="runtime-fill"
                  style={{
                    width: `${Math.min(Math.max(Number(solar?.battery_soc_percent || 0), 0), 100)}%`
                  }}
                />
              </div>

              <div className="runtime-details">
                <span>SOC: {formatNumber(solar?.battery_soc_percent, 0)}%</span>
                <span>Usable: {formatNumber(runtime?.usableKwh, 2)} kWh</span>
                <span>Current Inverted Load: {formatPowerKw(solar?.load_power_kw)}</span>
              </div>

              <div className="runtime-controls">
                <label>
                  Battery Capacity (kWh)
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={batteryCapacityKwh}
                    onChange={(event) => setBatteryCapacityKwh(event.target.value)}
                  />
                </label>

                <label>
                  Reserve SOC (%)
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={reserveSocPercent}
                    onChange={(event) => setReserveSocPercent(event.target.value)}
                  />
                </label>

                <label>
                  Runtime Efficiency (%)
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={Math.round(Number(inverterEfficiency) * 100)}
                    onChange={(event) => setInverterEfficiency(Number(event.target.value) / 100)}
                  />
                </label>
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
              label="Current Inverted Load"
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
        </>
      )}

      {activePage === "weather" && (
        <section className="panel weather-page">
          <div className="panel-header">
            <div>
              <div className="panel-title">Weather Forecast</div>
              <p>
                {SETUP.locationName} • {SETUP.latitude}, {SETUP.longitude}
              </p>
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
            <StatCard
              icon={<Sun size={24} />}
              label="Tomorrow Harvest"
              value={`${formatNumber(weather[1]?.expectedHarvestKwh, 1)} kWh`}
              sub={`Solar Index: ${weather[1] ? getSolarIndex(weather[1].sunKwh) : "--"}`}
            />
            <StatCard
              icon={<CloudSun size={24} />}
              label="Tomorrow Weather"
              value={weather[1] ? WEATHER_CODES[weather[1].code] || "Forecast" : "--"}
              sub={`Rain: ${weather[1]?.rain ?? "--"}%`}
            />
            <StatCard
              icon={<Thermometer size={24} />}
              label="Tomorrow UV Index"
              value={formatNumber(weather[1]?.uvIndex, 1)}
              sub="Higher means stronger sun exposure"
            />
            <StatCard
              icon={<CalendarDays size={24} />}
              label="7-Day Harvest"
              value={`${formatNumber(weather.reduce((sum, day) => sum + Number(day.expectedHarvestKwh || 0), 0), 1)} kWh`}
              sub="Estimated total solar harvest"
            />
          </div>

          <div className="weather-grid">
            {weather.map((day) => (
              <WeatherCard key={day.date} day={day} />
            ))}
          </div>
        </section>
      )}

      {activePage === "setup" && (
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
              <strong>{batteryCapacityKwh} kWh</strong>
            </div>
            <div>
              <span>Reserve SOC</span>
              <strong>{reserveSocPercent}%</strong>
            </div>
            <div>
              <span>Runtime Efficiency</span>
              <strong>{Math.round(Number(inverterEfficiency) * 100)}%</strong>
            </div>
            <div>
              <span>Forecast Location</span>
              <strong>{SETUP.latitude}, {SETUP.longitude}</strong>
            </div>
            <div>
              <span>Estimated Solar Array</span>
              <strong>{SETUP.solarArrayKw} kWp</strong>
            </div>
          </div>
        </section>
      )}

      <footer>
        <div>Made by Engr. Christian Louie Ethance Ochea, ECT</div>
        <div>
          Last refresh:{" "}
          {lastRefresh
            ? lastRefresh.toLocaleString("en-PH", {
                dateStyle: "medium",
                timeStyle: "medium"
              })
            : "--"}
        </div>
      </footer>
    </main>
  );
}
