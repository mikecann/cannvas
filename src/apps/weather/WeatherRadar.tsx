import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePolling } from "../../lib/usePolling";
import { BUSSELTON, WEATHER_REFRESH_MS } from "./forecast";

type RadarFrame = { time: number; path: string; forecast?: boolean };
type RadarResponse = {
  host: string;
  radar: { past?: RadarFrame[]; nowcast?: RadarFrame[] };
};

function radarTime(frame: RadarFrame | undefined) {
  if (!frame) return "";
  return new Date(frame.time * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function RadarScrubber({
  frames,
  frameIndex,
  onChange,
}: {
  frames: RadarFrame[];
  frameIndex: number;
  onChange: (index: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const progress = frames.length > 1 ? frameIndex / (frames.length - 1) : 0;

  const scrubTo = (clientX: number) => {
    const track = trackRef.current;
    if (!track || frames.length < 2) return;
    const bounds = track.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    onChange(Math.round(position * (frames.length - 1)));
  };

  const startScrubbing = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubTo(event.clientX);
  };

  const continueScrubbing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) scrubTo(event.clientX);
  };

  return (
    <div className="weather-radar-scrub-area">
      <div
        ref={trackRef}
        className="weather-radar-scrubber"
        role="slider"
        tabIndex={0}
        aria-label="Radar time"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, frames.length - 1)}
        aria-valuenow={frameIndex}
        aria-valuetext={radarTime(frames[frameIndex])}
        onPointerDown={startScrubbing}
        onPointerMove={continueScrubbing}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onChange(Math.max(0, frameIndex - 1));
          if (event.key === "ArrowRight") onChange(Math.max(0, Math.min(frames.length - 1, frameIndex + 1)));
        }}
      >
        <span className="weather-radar-scrubber-fill" style={{ width: `${progress * 100}%` }} />
        <span className="weather-radar-scrubber-thumb" style={{ left: `${progress * 100}%` }} />
        {frames.map((frame, index) => (
          <i
            className={`${index <= frameIndex ? "passed" : ""}${frame.forecast ? " forecast" : ""}`}
            style={{ left: `${frames.length > 1 ? index / (frames.length - 1) * 100 : 0}%` }}
            key={`${frame.time}:${frame.path}`}
          />
        ))}
      </div>
      <div className="weather-radar-range">
        <span>{radarTime(frames[0])}</span>
        <strong>{radarTime(frames[frameIndex])}</strong>
        <span>{frames.at(-1)?.forecast ? radarTime(frames.at(-1)) : "Now"}</span>
      </div>
    </div>
  );
}

export function WeatherRadar() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const radarLayerRef = useRef<L.TileLayer | null>(null);
  const radarLayerPathRef = useRef("");
  const desiredRadarPathRef = useRef("");
  const pendingRadarLayersRef = useRef(new Map<string, L.TileLayer>());
  const radarRenderTimeRef = useRef(0);
  const [host, setHost] = useState("");
  const [frames, setFrames] = useState<RadarFrame[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [renderedFrameIndex, setRenderedFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [radarError, setRadarError] = useState(false);

  usePolling(async () => {
    try {
      const response = await fetch("https://api.rainviewer.com/public/weather-maps.json");
      if (!response.ok) throw new Error(`Radar returned ${response.status}`);
      const data = await response.json() as RadarResponse;
      const past = data.radar.past ?? [];
      const nowcast = (data.radar.nowcast ?? []).map((frame) => ({ ...frame, forecast: true }));
      const nextFrames = [...past, ...nowcast];
      setHost(data.host);
      setFrames(nextFrames);
      setFrameIndex(Math.max(0, nextFrames.length - 1));
      setRadarError(nextFrames.length === 0);
    } catch {
      setRadarError(true);
    }
  }, WEATHER_REFRESH_MS);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: true,
      minZoom: 6,
      maxZoom: 12,
    }).setView([BUSSELTON.latitude, BUSSELTON.longitude], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      className: "weather-base-map",
      maxZoom: 19,
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
      radarLayerPathRef.current = "";
      desiredRadarPathRef.current = "";
      pendingRadarLayersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const render = () => {
      radarRenderTimeRef.current = performance.now();
      setRenderedFrameIndex(frameIndex);
    };
    const remaining = 180 - (performance.now() - radarRenderTimeRef.current);
    if (remaining <= 0) render();
    else timer = window.setTimeout(render, remaining);
    return () => window.clearTimeout(timer);
  }, [frameIndex]);

  useEffect(() => {
    const map = mapRef.current;
    const frame = frames[renderedFrameIndex];
    if (!map || !host || !frame) return;
    desiredRadarPathRef.current = frame.path;
    if (radarLayerPathRef.current === frame.path || pendingRadarLayersRef.current.has(frame.path)) return;

    const nextLayer = L.tileLayer(`${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
      tileSize: 256,
      opacity: 0,
      maxNativeZoom: 7,
      maxZoom: 12,
      attribution: "Radar &copy; RainViewer",
    }).addTo(map);
    pendingRadarLayersRef.current.set(frame.path, nextLayer);

    // Keep the old frame visible while the next set of tiles loads. Once it is
    // ready, Leaflet fades the complete frame in rather than flashing empty map.
    // Pending frames continue loading during a fast scrub so going back can use
    // the browser cache instead of starting the same tile requests again.
    nextLayer.once("load", () => {
      pendingRadarLayersRef.current.delete(frame.path);
      if (desiredRadarPathRef.current !== frame.path) {
        // Leaflet still reads the layer's map after firing `load`, so removing
        // it inside that callback causes a null-map error. Drop it next tick.
        window.setTimeout(() => {
          if (mapRef.current === map && map.hasLayer(nextLayer)) map.removeLayer(nextLayer);
        }, 0);
        return;
      }
      const previousLayer = radarLayerRef.current;
      radarLayerRef.current = nextLayer;
      radarLayerPathRef.current = frame.path;
      nextLayer.setOpacity(.78);
      if (previousLayer && previousLayer !== nextLayer) {
        window.setTimeout(() => {
          if (map.hasLayer(previousLayer)) map.removeLayer(previousLayer);
        }, 220);
      }
    });
  }, [renderedFrameIndex, frames, host]);

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
          <strong>{frame ? radarTime(frame) : "Loading radar"}</strong>
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
        <RadarScrubber
          frames={frames}
          frameIndex={frameIndex}
          onChange={(index) => { setPlaying(false); setFrameIndex(index); }}
        />
        <button onClick={() => setFrameIndex((index) => Math.min(frames.length - 1, index + 1))} disabled={frameIndex >= frames.length - 1} aria-label="Next radar frame"><ChevronRight /></button>
      </div>
      {!hasForecastFrames && <p className="weather-radar-note">The radar shows measured rain. The 12-hour timeline shows what is expected next.</p>}
    </section>
  );
}
