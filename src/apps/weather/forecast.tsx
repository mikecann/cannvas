import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Snowflake,
  Sun,
} from "lucide-react";
import type { ComponentType } from "react";

export const BUSSELTON = { latitude: -33.6516, longitude: 115.3470 };
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
const WEATHER_CACHE_KEY = "cannvas-weather-v1";

export const FORECAST_URL = new URL("https://api.open-meteo.com/v1/forecast");
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

export type WeatherForecast = {
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

type Condition = {
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export function conditionFor(code: number): Condition {
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

export function WeatherIcon({ code, className }: { code: number; className?: string }) {
  const Icon = conditionFor(code).icon;
  return <Icon className={className} />;
}

export function round(value: number | undefined, fallback = 0) {
  return Math.round(Number.isFinite(value) ? Number(value) : fallback);
}

export function readWeatherCache(): WeatherForecast | null {
  try {
    const cached = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) ?? "null") as WeatherForecast | null;
    return cached?.current && cached?.hourly && cached?.daily ? cached : null;
  } catch {
    return null;
  }
}

export function writeWeatherCache(forecast: WeatherForecast) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(forecast));
  } catch {
    // A full or blocked store only costs the offline fallback.
  }
}

export function hourLabel(value: string, index: number) {
  if (index === 0) return "Now";
  return new Date(value).toLocaleTimeString("en-AU", { hour: "numeric" });
}

export function dayLabel(value: string, index: number) {
  if (index === 0) return "Today";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short" });
}

export function windDirection(degrees: number) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(degrees / 45) % directions.length];
}

export function uvLabel(value: number) {
  if (value < 3) return "Low";
  if (value < 6) return "Moderate";
  if (value < 8) return "High";
  if (value < 11) return "Very high";
  return "Extreme";
}
