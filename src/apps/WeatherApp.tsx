import {
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Eye,
  Gauge,
  Navigation,
  Pause,
  Play,
  RefreshCw,
  Snowflake,
  Sun,
  Sunrise,
  Sunset,
  Wind,
} from "lucide-react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";

const BUSSELTON = { latitude: -33.6516, longitude: 115.3470 };
const WEATHER_CACHE_KEY = "cannvas-weather-v1";
const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const FORECAST_URL = new URL("https://api.open-meteo.com/v1/forecast");
FORECAST_URL.search = new URLSearchParams({
  latitude: String(BUSSELTON.latitude),
  longitude: String(BUSSELTON.longitude),
  timezone: "Australia/Perth",
  forecast_days: "10",
  current: [
    "temperature_2m",
    "relative_humidity_2m",
    "apparent_temperature",
    "precipitation",
    "weather_code",
    "cloud_cover",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
  ].join(","),
  hourly: [
    "temperature_2m",
    "apparent_temperature",
    "precipitation_probability",
    "precipitation",
    "weather_code",
    "relative_humidity_2m",
    "visibility",
    "pressure_msl",
    "uv_index",
    "wind_speed_10m",
    "wind_gusts_10m",
  ].join(","),
  daily: [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_probability_max",
    "precipitation_sum",
    "sunrise",
    "sunset",
    "uv_index_max",
  ].join(","),
}).toString();

type WeatherSeries = {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation_probability: number[];
  precipitation: number[];
  weather_code: number[];
  relative_humidity_2m: number[];
  visibility: number[];
  pressure_msl: number[];
  uv_index: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
};

type WeatherForecast = {
  current: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    weather_code: number;
    cloud_cover: number;
    pressure_msl: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    wind_gusts_10m: number;
  };
  hourly: WeatherSeries;
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
    precipitation_sum: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: number[];
  };
};

type RadarFrame = { time: number; path: string; forecast?: boolean };
type RadarResponse = {
  host: string;
  radar: { past?: RadarFrame[]; nowcast?: RadarFrame[] };
};

type Condition = {
  label: string;
  icon: ComponentType<{ className?: string }>;
};

function conditionFor(code: number): Condition {
  if (code === 0) return { label: "Clear", icon: Sun };
  if (code <= 2) return { label: "Partly cloudy", icon: CloudSun };
  if (code === 3) return { label: "Cloudy", icon: Cloud };
  if (code === 45 || code === 48) return { label: "Foggy", icon: CloudFog };
  if (code >= 51 && code <= 67) return { label: code >= 61 ? "Rain" : "Drizzle", icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: Snowflake };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: CloudRain };
  if (code >= 85 && code <= 86) return { label: "Snow showers", icon: Snowflake };
  if (code >= 95) return { label: "Thunderstorms", icon: CloudLightning };
  return { label: "Mixed conditions", icon: CloudSun };
}

function round(value: number | undefined, fallback = 0) {
  return Math.round(Number.isFinite(value) ? Number(value) : fallback);
}

function readWeatherCache(): WeatherForecast | null {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) ?? "null") as WeatherForecast | null;
    return cached?.current && cached?.hourly && cached?.daily ? cached : null;
  } catch {
    return null;
  }
}

function hourLabel(value: string, index: number) {
  if (index === 0) return "Now";
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric" });
}

function dayLabel(value: string, index: number) {
  if (index === 0) return "Today";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short" });
}

function windDirection(degrees: number) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

function uvLabel(value: number) {
  if (value < 3) return "Low";
  if (value < 6) return "Moderate";
  if (value < 8) return "High";
  if (value < 11) return "Very high";
  return "Extreme";
}

function WeatherIcon({ code, className }: { code: number; className?: string }) {
  const Icon = conditionFor(code).icon;
  return <Icon className={className} />;
}

function WeatherRadar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const [host, setHost] = useState("");
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [radarError, setRadarError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!response.ok) throw new Error(`Radar returned ${response.status}`);
        const data = await response.json() as RadarResponse;
        if (cancelled) return;
        const past = data.radar.past ?? [];
        const nowcast = (data.radar.nowcast ?? []).map((frame) => ({ ...frame, forecast: true }));
        const nextFrames = [...past, ...nowcast];
        setHost(data.host);
        setFrames(nextFrames);
        setFrameIndex(Math.max(0, nextFrames.length - 1));
        setRadarError(nextFrames.length === 0);
      } catch {
        if (!cancelled) setRadarError(true);
      }
    };
    void load();
    const timer = window.setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
      minZoom: 6,
      maxZoom: 12,
    }).setView([BUSSELTON.latitude, BUSSELTON.longitude], 8);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    L.circleMarker([BUSSELTON.latitude, BUSSELTON.longitude], {
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#4a9eff",
      fillOpacity: 1,
    }).bindTooltip("Busselton", { permanent: true, direction: "right", offset: [8, 0] }).addTo(map);
    mapRef.current = map;
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      radarLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const frame = frames[frameIndex];
    if (!map || !host || !frame) return;
    if (radarLayerRef.current) map.removeLayer(radarLayerRef.current);
    radarLayerRef.current = L.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      tileSize: 256,
      opacity: 0.78,
      maxNativeZoom: 7,
      maxZoom: 12,
      attribution: "Radar &copy; RainViewer",
    }).addTo(map);
  }, [frameIndex, frames, host]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const timer = window.setInterval(() => {
      setFrameIndex((index) => (index + 1) % frames.length);
    }, 750);
    return () => window.clearInterval(timer);
  }, [frames.length, playing]);

  const frame = frames[frameIndex];
  const hasForecastFrames = frames.some(({ forecast }) => forecast);

  return (
    <section className="weather-card weather-radar-card">
      <div className="weather-card-heading">
        <div>
          <span>Precipitation radar</span>
          <strong>{frame ? new Date(frame.time * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : "Loading radar"}</strong>
        </div>
        <small>{hasForecastFrames ? "Observed and forecast" : "Observed, past 2 hours"}</small>
      </div>
      <div className="weather-radar-map" ref={containerRef} aria-label="Rain radar map centred on Busselton">
        {radarError && <div className="weather-radar-error">Radar is temporarily unavailable</div>}
        <div className="weather-radar-key"><i />Light <i />Heavy</div>
      </div>
      <div className="weather-radar-controls">
        <button onClick={() => setFrameIndex((index) => Math.max(0, index - 1))} disabled={frameIndex === 0} aria-label="Previous radar frame"><ChevronLeft /></button>
        <button className="weather-radar-play" onClick={() => setPlaying((value) => !value)} disabled={frames.length < 2} aria-label={playing ? "Pause radar" : "Play radar"}>{playing ? <Pause /> : <Play />}</button>
        <input
          type="range"
          min="0"
          max={Math.max(0, frames.length - 1)}
          value={frameIndex}
          onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }}
          aria-label="Radar time"
        />
        <button onClick={() => setFrameIndex((index) => Math.min(frames.length - 1, index + 1))} disabled={frameIndex >= frames.length - 1} aria-label="Next radar frame"><ChevronRight /></button>
      </div>
      {!hasForecastFrames && <p className="weather-radar-note">The radar shows measured rain. The 12-hour timeline shows what is expected next.</p>}
    </section>
  );
}

export function WeatherApp() {
  const [forecast, setForecast] = useState<WeatherForecast | null>(() => readWeatherCache());
  const [loading, setLoading] = useState(!forecast);
  const [error, setError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(FORECAST_URL);
        if (!response.ok) throw new Error(`Forecast returned ${response.status}`);
        const data = await response.json() as WeatherForecast;
        if (cancelled) return;
        setForecast(data);
        setError(false);
        localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(data));
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshVersion]);

  const currentHourIndex = useMemo(() => {
    if (!forecast) return 0;
    const currentTime = new Date(forecast.current.time).getTime();
    const firstFuture = forecast.hourly.time.findIndex((time) => new Date(time).getTime() >= currentTime);
    return Math.max(0, firstFuture);
  }, [forecast]);

  if (!forecast) {
    return (
      <section className="weather-app weather-app-loading">
        <RefreshCw />
        <strong>{error ? "Weather is temporarily unavailable" : "Loading Busselton weather"}</strong>
        {error && <button onClick={() => { setLoading(true); setRefreshVersion((value) => value + 1); }}>Try again</button>}
      </section>
    );
  }

  const condition = conditionFor(forecast.current.weather_code);
  const CurrentIcon = condition.icon;
  const hourly = forecast.hourly.time.slice(currentHourIndex, currentHourIndex + 12).map((time, offset) => {
    const index = currentHourIndex + offset;
    return {
      time,
      temperature: forecast.hourly.temperature_2m[index],
      rainChance: forecast.hourly.precipitation_probability[index],
      rain: forecast.hourly.precipitation[index],
      code: forecast.hourly.weather_code[index],
    };
  });
  const detailIndex = currentHourIndex;
  const todayHigh = forecast.daily.temperature_2m_max[0];
  const todayLow = forecast.daily.temperature_2m_min[0];
  const nextRain = hourly.find(({ rainChance, rain }) => rainChance >= 30 || rain > 0);
  const rainSummary = nextRain
    ? `${round(nextRain.rainChance)}% chance of rain ${nextRain === hourly[0] ? "now" : `around ${hourLabel(nextRain.time, 1)}`}`
    : "No rain expected in the next 12 hours";
  const updatedAt = new Date(forecast.current.time).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

  return (
    <section className={`weather-app weather-code-${forecast.current.weather_code}`}>
      <div className="weather-sky" aria-hidden="true"><i /><i /><i /></div>
      <div className="weather-scroll">
        <header className="weather-hero">
          <div>
            <p>Busselton</p>
            <div className="weather-current-temperature">{round(forecast.current.temperature_2m)}°</div>
            <strong>{condition.label}</strong>
            <span>Feels like {round(forecast.current.apparent_temperature)}° · H:{round(todayHigh)}° L:{round(todayLow)}°</span>
          </div>
          <CurrentIcon className="weather-current-icon" />
          <button
            className="weather-refresh"
            onClick={() => { setLoading(true); setRefreshVersion((value) => value + 1); }}
            disabled={loading}
            aria-label="Refresh weather"
          ><RefreshCw /></button>
        </header>

        {error && <div className="weather-stale-message">Could not refresh. Showing the last forecast saved on this display.</div>}

        <section className="weather-card weather-hourly-card">
          <div className="weather-card-heading">
            <div><span>Next 12 hours</span><strong>{rainSummary}</strong></div>
            <small>Updated {updatedAt}</small>
          </div>
          <div className="weather-hourly-row">
            {hourly.map((hour, index) => (
              <article key={hour.time}>
                <strong>{hourLabel(hour.time, index)}</strong>
                <WeatherIcon code={hour.code} />
                <span className={hour.rainChance >= 30 ? "has-rain" : undefined}>{round(hour.rainChance)}%</span>
                <b>{round(hour.temperature)}°</b>
              </article>
            ))}
          </div>
        </section>

        <WeatherRadar />

        <section className="weather-card weather-daily-card">
          <div className="weather-card-heading"><div><span>10-day forecast</span><strong>Daily outlook</strong></div></div>
          <div className="weather-daily-list">
            {forecast.daily.time.map((time, index) => (
              <article key={time}>
                <strong>{dayLabel(time, index)}</strong>
                <WeatherIcon code={forecast.daily.weather_code[index]} />
                <span>{round(forecast.daily.precipitation_probability_max[index])}%</span>
                <small>{round(forecast.daily.temperature_2m_min[index])}°</small>
                <i><b style={{ width: `${Math.max(12, Math.min(100, (forecast.daily.temperature_2m_max[index] - forecast.daily.temperature_2m_min[index]) * 7))}%` }} /></i>
                <strong>{round(forecast.daily.temperature_2m_max[index])}°</strong>
              </article>
            ))}
          </div>
        </section>

        <div className="weather-details-grid">
          <article className="weather-card"><div><Wind /><span>Wind</span></div><strong>{round(forecast.current.wind_speed_10m)} <small>km/h</small></strong><p>{windDirection(forecast.current.wind_direction_10m)} · Gusts {round(forecast.current.wind_gusts_10m)} km/h</p><Navigation style={{ transform: `rotate(${forecast.current.wind_direction_10m + 180}deg)` }} /></article>
          <article className="weather-card"><div><Droplets /><span>Humidity</span></div><strong>{round(forecast.current.relative_humidity_2m)}%</strong><p>Feels like {round(forecast.current.apparent_temperature)}°</p></article>
          <article className="weather-card"><div><Sun /><span>UV index</span></div><strong>{round(forecast.hourly.uv_index[detailIndex])}</strong><p>{uvLabel(forecast.hourly.uv_index[detailIndex])}</p><i className="uv-scale" /></article>
          <article className="weather-card"><div><Eye /><span>Visibility</span></div><strong>{round(forecast.hourly.visibility[detailIndex] / 1000)} <small>km</small></strong><p>{forecast.hourly.visibility[detailIndex] >= 10000 ? "Clear view" : "Reduced visibility"}</p></article>
          <article className="weather-card"><div><Gauge /><span>Pressure</span></div><strong>{round(forecast.current.pressure_msl)} <small>hPa</small></strong><p>Sea-level pressure</p></article>
          <article className="weather-card weather-sun-card"><div><Sunset /><span>Sunset</span></div><strong>{new Date(forecast.daily.sunset[0]).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</strong><p><Sunrise /> Sunrise {new Date(forecast.daily.sunrise[1] ?? forecast.daily.sunrise[0]).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</p></article>
        </div>

        <footer className="weather-attribution">Forecast by Open-Meteo · Radar by RainViewer · Map by OpenStreetMap and CARTO</footer>
      </div>
    </section>
  );
}
