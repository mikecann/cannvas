import { CloudRain, CloudSun, Droplets, Sun, Wind } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const VIDEO_ROOT = "http://192.168.1.168:6113/Josh%20Photos/";
const VIDEO_CACHE_KEY = "cannvas-video-list-v1";
const VIDEO_PATTERN = /<a href="([^"]+)"/g;

type Weather = {
  temperature: number;
  apparent: number;
  humidity: number;
  wind: number;
  code: number;
  max: number;
  min: number;
};

function weatherLabel(code: number) {
  if (code === 0) return "Clear skies";
  if (code <= 3) return "Partly cloudy";
  if (code <= 48) return "Misty";
  if (code <= 67) return "Rainy";
  if (code <= 77) return "Wintry";
  if (code <= 82) return "Showers";
  return "Stormy";
}

function WeatherIcon({ code }: { code: number }) {
  if (code === 0) return <Sun />;
  if (code >= 51) return <CloudRain />;
  return <CloudSun />;
}

async function crawlVideos(root = VIDEO_ROOT, depth = 0, visited = new Set<string>()): Promise<string[]> {
  if (depth > 5 || visited.has(root)) return [];
  visited.add(root);
  const response = await fetch(root);
  if (!response.ok) throw new Error(`Video server returned ${response.status}`);
  const html = await response.text();
  const urls = [...html.matchAll(VIDEO_PATTERN)]
    .map((match) => new URL(match[1], root).toString())
    .filter((url) => !url.includes("../"));
  const videos = urls.filter((url) => /\.(mp4|m4v|mov|webm)$/i.test(url));
  const folders = urls.filter((url) => url.endsWith("/") && url !== root);
  const nested = await Promise.all(folders.map((folder) => crawlVideos(folder, depth + 1, visited)));
  return [...videos, ...nested.flat()];
}

export function DisplayApp() {
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<Weather | null>(null);
  const [videos, setVideos] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(VIDEO_CACHE_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const [videoIndex, setVideoIndex] = useState(() => Math.floor(Math.random() * Math.max(1, videos.length)));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadWeather = async () => {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.search = new URLSearchParams({
        latitude: "-33.6525",
        longitude: "115.3455",
        timezone: "Australia/Perth",
        current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
        daily: "temperature_2m_max,temperature_2m_min",
        forecast_days: "1",
      }).toString();
      const response = await fetch(url);
      const data = await response.json();
      setWeather({
        temperature: data.current.temperature_2m,
        apparent: data.current.apparent_temperature,
        humidity: data.current.relative_humidity_2m,
        wind: data.current.wind_speed_10m,
        code: data.current.weather_code,
        max: data.daily.temperature_2m_max[0],
        min: data.daily.temperature_2m_min[0],
      });
    };
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void crawlVideos().then((found) => {
      if (found.length > 0) {
        setVideos(found);
        localStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify(found));
      }
    }).catch(() => undefined);
  }, []);

  const currentVideo = videos[videoIndex % Math.max(1, videos.length)];
  const videoCaption = useMemo(() => {
    if (!currentVideo) return "Family moments";
    const parts = decodeURIComponent(currentVideo).split("/");
    return parts.slice(-3, -1).filter(Boolean).join(" · ") || "Family moments";
  }, [currentVideo]);

  return (
    <section className="display-app">
      <div className="display-media">
        {currentVideo ? (
          <video key={currentVideo} src={currentVideo} autoPlay muted playsInline onEnded={() => setVideoIndex((value) => value + 1)} onError={() => setVideoIndex((value) => value + 1)} />
        ) : (
          <div className="display-gradient"><span>C</span></div>
        )}
        <div className="media-shade" />
      </div>

      <div className="display-content">
        <p className="display-date">{now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</p>
        <div className="display-time">{now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
        <p className="media-caption">{videoCaption}</p>
      </div>

      <aside className="weather-panel">
        {weather ? (
          <>
            <div className="weather-main"><WeatherIcon code={weather.code} /><strong>{Math.round(weather.temperature)}°</strong></div>
            <h2>{weatherLabel(weather.code)}</h2>
            <p>Feels like {Math.round(weather.apparent)}°</p>
            <div className="weather-high-low"><span>High {Math.round(weather.max)}°</span><span>Low {Math.round(weather.min)}°</span></div>
            <div className="weather-details"><span><Droplets /> {weather.humidity}%</span><span><Wind /> {Math.round(weather.wind)} km/h</span></div>
            <small>Busselton</small>
          </>
        ) : (
          <div className="weather-loading"><CloudSun /><span>Checking the weather…</span></div>
        )}
      </aside>

      <div className="wake-hint">Tap anywhere to return</div>
    </section>
  );
}
