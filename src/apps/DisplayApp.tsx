import { Home, Sun, UtilityPole, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { useNews } from "../data/DataProvider";
import { FLOW_THRESHOLD_KW, formatKw, isSolarFresh } from "../lib/solar";
import { useMinuteClock } from "../lib/useMinuteClock";
import { useSolar } from "../lib/useSolar";
import { CalendarHomeWidget } from "./display/CalendarHomeWidget";
import { IdleVideo } from "./display/IdleVideo";

const YR_METEOGRAM = "https://www.yr.no/en/content/2-2075265/meteogram.svg";

export function DisplayApp({
  displaySession,
  onActivity,
  onOpenCalendar,
  onOpenWeather,
  onOpenSolar,
}: {
  displaySession: number;
  onActivity: () => void;
  onOpenCalendar: () => void;
  onOpenWeather: () => void;
  onOpenSolar: () => void;
}) {
  const [videoAudio, setVideoAudio] = useState(() => ({ session: displaySession, muted: true }));
  const [videoPlayable, setVideoPlayable] = useState(false);

  // Derive this during render so a new session is muted before the video can
  // commit or produce even a brief audio blip. The stored choice only belongs
  // to the display session in which the user made it.
  const videoMuted = videoAudio.session === displaySession ? videoAudio.muted : true;

  return (
    <section className="display-app">
      <IdleVideo muted={videoMuted} onPlayableChange={setVideoPlayable} />
      <IdleClock />
      <CalendarHomeWidget onOpen={onOpenCalendar} />

      <div className="display-widgets">
        <SolarHomeWidget onOpen={onOpenSolar} />
        <WeatherWidget onOpen={onOpenWeather} />
        <NewsWidget />
        {videoPlayable && (
          <button
            type="button"
            className={`display-audio-toggle${videoMuted ? "" : " is-playing"}`}
            aria-label={videoMuted ? "Turn video sound on" : "Mute video"}
            aria-pressed={!videoMuted}
            onPointerDown={(event) => {
              // Keep this tap from waking the previous app, but still restart
              // the idle clock so sound is muted again after inactivity.
              event.stopPropagation();
              onActivity();
            }}
            onClick={() => setVideoAudio({ session: displaySession, muted: !videoMuted })}
          >
            {videoMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </button>
        )}
      </div>
    </section>
  );
}

// Its own component, so the minute tick re-renders only the clock.
function IdleClock() {
  const now = useMinuteClock();
  return (
    <div className="display-content">
      <p className="display-date">{now.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</p>
      <div className="display-time">{now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })}</div>
    </div>
  );
}

function WeatherWidget({ onOpen }: { onOpen: () => void }) {
  const [weatherVersion, setWeatherVersion] = useState(Date.now());

  useEffect(() => {
    // Mike's Smarter Mirror refreshed this same Yr image every two hours.
    const timer = window.setInterval(() => setWeatherVersion(Date.now()), 2 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <button
      type="button"
      className="weather-panel yr-weather-panel"
      aria-label="Open detailed Busselton weather"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onOpen}
    >
      <span className="yr-weather-frame">
        <img src={`${YR_METEOGRAM}?bust=${weatherVersion}`} alt="Busselton weather forecast from Yr" />
      </span>
    </button>
  );
}

function NewsWidget() {
  const { newsHeadlines } = useNews();
  const headlines = newsHeadlines.length > 0 ? newsHeadlines : [{ title: "Loading latest headlines…", url: "" }];
  return (
    <aside className="weather-panel news-panel">
      <div className="news-header"><span>BBC News</span></div>
      <div className="news-headlines">
        {headlines.slice(0, 3).map((headline) => (
          <p key={headline.title}>{headline.title}</p>
        ))}
      </div>
    </aside>
  );
}

function SolarHomeWidget({ onOpen }: { onOpen: () => void }) {
  const state = useSolar(15000);
  if (state.kind !== "ready" || !state.solar.configured || !state.solar.now || !isSolarFresh(state.solar)) return null;
  const { now } = state.solar;
  const gridKw = now.gridKw;
  return (
    <button
      type="button"
      className="solar-home-widget"
      aria-label="Open solar details"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onOpen}
    >
      <span className="solar"><Sun aria-hidden="true" />{formatKw(now.solarKw)}</span>
      <span><Home aria-hidden="true" />{formatKw(now.houseKw)}</span>
      <span className={gridKw == null ? undefined : gridKw > FLOW_THRESHOLD_KW ? "buying" : gridKw < -FLOW_THRESHOLD_KW ? "selling" : undefined}>
        <UtilityPole aria-hidden="true" />{gridKw == null ? "–" : Math.abs(gridKw) > FLOW_THRESHOLD_KW ? formatKw(gridKw) : "0 W"}
      </span>
    </button>
  );
}
