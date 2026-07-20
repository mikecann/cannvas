import { useEffect, useMemo, useState } from "react";

// The mirror streams Joshua's videos directly from the Josh Photos share.
const VIDEO_ROOT = "http://192.168.1.168:6113/Josh%20Photos/";
const VIDEO_CACHE_KEY = "cannvas-video-list-v1";
const VIDEO_PATTERN = /<a href="([^"]+)"/g;
const YR_METEOGRAM = "https://www.yr.no/en/content/2-2075265/meteogram.svg";

async function crawlVideos(root = VIDEO_ROOT, depth = 0, visited = new Set<string>()): Promise<string[]> {
  if (depth > 10 || visited.has(root)) return [];
  visited.add(root);
  const response = await fetch(root);
  if (!response.ok) throw new Error(`Video server returned ${response.status}`);
  const html = await response.text();
  const urls = [...html.matchAll(VIDEO_PATTERN)]
    .map((match) => match[1])
    .filter((href) => href !== "../" && href !== "./../")
    .map((href) => new URL(href, root).toString())
    .filter((url) => url.startsWith(VIDEO_ROOT));
  const videos = urls.filter((url) => /\.(mp4|m4v|mov|webm)$/i.test(url));
  const folders = urls.filter((url) => url.endsWith("/") && url !== root);
  const nested = await Promise.all(folders.map((folder) => crawlVideos(folder, depth + 1, visited)));
  return [...videos, ...nested.flat()];
}

export function DisplayApp() {
  const [now, setNow] = useState(new Date());
  const [weatherVersion, setWeatherVersion] = useState(Date.now());
  const [videos, setVideos] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(VIDEO_CACHE_KEY) ?? "[]") as string[]; } catch { return []; }
  });
  const [videoIndex, setVideoIndex] = useState(() => Math.floor(Math.random() * Math.max(1, videos.length)));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    // Mike's Smarter Mirror refreshed this same Yr image every two hours.
    const timer = window.setInterval(() => setWeatherVersion(Date.now()), 2 * 60 * 60 * 1000);
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
    if (!currentVideo) return "Loading Josh Photos…";
    const parts = decodeURIComponent(new URL(currentVideo).pathname).split("/").filter(Boolean);
    return parts.at(-2) ?? "Josh Photos";
  }, [currentVideo]);

  return (
    <section className="display-app">
      <div className="display-media">
        {currentVideo ? (
          <video key={currentVideo} src={currentVideo} autoPlay muted playsInline onEnded={() => setVideoIndex((value) => value + 1)} onError={() => setVideoIndex((value) => value + 1)} />
        ) : (
          <div className="display-gradient"><span>C</span></div>
        )}
      </div>

      <div className="display-content">
        <p className="display-date">{now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</p>
        <div className="display-time">{now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
        <p className="media-caption">{videoCaption}</p>
      </div>

      <aside className="weather-panel yr-weather-panel">
        <div className="yr-weather-heading">
          <strong>Busselton weather</strong>
          <span>Yr</span>
        </div>
        <div className="yr-weather-frame">
          <img src={`${YR_METEOGRAM}?bust=${weatherVersion}`} alt="Busselton weather forecast from Yr" />
        </div>
      </aside>

      <div className="wake-hint">Tap anywhere to return</div>
    </section>
  );
}
