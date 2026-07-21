import { CalendarDays, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCannvasData } from "../data/DataProvider";
import { addCalendarDays, calendarDateKey, calendarEventTime, eventsForDate } from "../lib/calendar";

// The mirror streams Joshua's videos directly from the Josh Photos share.
const VIDEO_ROOT = "http://192.168.1.168:6113/Josh%20Photos/";
const VIDEO_CACHE_KEY = "cannvas-video-list-v2";
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
  const { calendarEvents, calendarStatus, newsHeadlines } = useCannvasData();
  const [now, setNow] = useState(new Date());
  const [calendarExpanded, setCalendarExpanded] = useState(false);
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
  const todayKey = calendarDateKey(now);
  const todayEvents = useMemo(() => eventsForDate(calendarEvents, todayKey), [calendarEvents, todayKey]);
  const upcomingEvents = useMemo(() => {
    const result = [];
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = addCalendarDays(now, offset);
      const key = calendarDateKey(date);
      for (const event of eventsForDate(calendarEvents, key)) {
        result.push({ event, date, key: `${key}:${event.id}` });
      }
    }
    return result;
  }, [calendarEvents, todayKey]);
  const hiddenUpcomingCount = Math.max(0, upcomingEvents.length - 4);
  const visibleUpcomingEvents = calendarExpanded ? upcomingEvents : upcomingEvents.slice(0, 4);

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
      </div>

      <aside
        className={`calendar-home-widget${calendarExpanded ? " expanded" : ""}${hiddenUpcomingCount > 0 ? " has-more" : ""}`}
        aria-label={`Calendar for today and the next seven days. ${calendarExpanded ? "Tap to collapse" : "Tap to expand"}.`}
        aria-expanded={calendarExpanded}
        role="button"
        tabIndex={0}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setCalendarExpanded((expanded) => !expanded)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setCalendarExpanded((expanded) => !expanded);
          }
        }}
      >
        <header><CalendarDays /><div><strong>Calendar</strong><span>Next 7 days</span></div></header>
        <section>
          <h2>Today</h2>
          <div className="calendar-home-list">
            {todayEvents.slice(0, 3).map((event) => (
              <article key={event.id}><span className="calendar-home-time">{calendarEventTime(event)}</span><strong>{event.title}</strong></article>
            ))}
            {calendarStatus === "ready" && todayEvents.length === 0 && <p className="calendar-home-empty">Nothing planned today</p>}
          </div>
        </section>
        <section>
          <h2>Upcoming</h2>
          <div className="calendar-home-list upcoming">
            {visibleUpcomingEvents.map(({ event, date, key }) => (
              <article key={key}>
                <span className="calendar-home-day">{date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })}</span>
                <strong>{event.title}</strong>
                <small><Clock3 /> {calendarEventTime(event)}</small>
              </article>
            ))}
            {calendarStatus === "ready" && upcomingEvents.length === 0 && <p className="calendar-home-empty">Nothing in the next 7 days</p>}
          </div>
          {hiddenUpcomingCount > 0 && !calendarExpanded && <p className="calendar-home-expand-hint">Tap to show {hiddenUpcomingCount} more</p>}
          {calendarExpanded && upcomingEvents.length > 4 && <p className="calendar-home-expand-hint">Tap to collapse</p>}
        </section>
        {calendarStatus !== "ready" && calendarEvents.length === 0 && (
          <p className="calendar-home-status">{calendarStatus === "not-configured" ? "Connect Google Calendar to see your schedule" : calendarStatus === "error" ? "Calendar is temporarily unavailable" : "Loading calendar…"}</p>
        )}
      </aside>

      <div className="display-widgets">
        <aside className="weather-panel yr-weather-panel">
          <div className="yr-weather-frame">
            <img src={`${YR_METEOGRAM}?bust=${weatherVersion}`} alt="Busselton weather forecast from Yr" />
          </div>
        </aside>
        <aside className="weather-panel news-panel">
          <div className="news-header"><span>BBC News</span></div>
          <div className="news-headlines">
            {(newsHeadlines.length > 0 ? newsHeadlines : [{ title: "Loading latest headlines…", url: "" }]).slice(0, 3).map((headline) => (
              <p key={headline.title}>{headline.title}</p>
            ))}
          </div>
        </aside>
      </div>

      <div className="wake-hint">Tap anywhere to return</div>
    </section>
  );
}
