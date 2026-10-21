import { AlertTriangle, BatteryCharging, Droplets, House, LoaderCircle, MapIcon, Pause, Play, Sofa, Wrench } from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";
import { whenLabel } from "../../lib/dates";
import { runHomeAssistantAction } from "../../lib/homeAssistantAction";
import { errorText } from "../../lib/http";
import { useMinuteClock } from "../../lib/useMinuteClock";
import {
  consumableLabel,
  LIVING_ROOM_AND_KITCHEN,
  lowConsumables,
  type Vacuum,
  type VacuumAction,
  vacuumActions,
  vacuumHeadline,
} from "../../lib/vacuum";

// The Roborock reports back through its cloud, so check twice after a tap.
const AFTER_ACTION_REFRESH_MS = [2_000, 8_000];

export function VacuumCard({ vacuum, onChanged }: { vacuum: Vacuum; onChanged: () => void }) {
  const now = useMinuteClock();
  const [pending, setPending] = useState<VacuumAction | null>(null);
  const [error, setError] = useState("");
  const headline = vacuumHeadline(vacuum);
  const allowed = vacuumActions(vacuum);
  const consumables = lowConsumables(vacuum.consumables);

  const run = async (action: VacuumAction) => {
    if (pending) return;
    setPending(action);
    setError("");
    try {
      await runHomeAssistantAction(vacuum.entityId, action, "The vacuum didn't respond", action === "clean_area" ? LIVING_ROOM_AND_KITCHEN : undefined);
      for (const delay of AFTER_ACTION_REFRESH_MS) window.setTimeout(onChanged, delay);
    } catch (requestError) {
      setError(errorText(requestError, "The vacuum didn't respond"));
    } finally {
      setPending(null);
    }
  };

  const button = (action: VacuumAction, label: string, Icon: typeof Play, primary = false) => (
    <button
      type="button"
      className={`${primary ? "is-primary" : ""}${pending === action ? " is-pending" : ""}`}
      disabled={!allowed[action] || pending !== null}
      onClick={() => void run(action)}
    >
      {pending === action ? <LoaderCircle aria-hidden="true" /> : <Icon aria-hidden="true" />}
      {label}
    </button>
  );

  const lastClean = vacuum.state !== "cleaning" && vacuum.lastClean
    ? [
      `Last clean ${whenLabel(vacuum.lastClean, now)}`,
      vacuum.cleaningArea === null ? "" : `${vacuum.cleaningArea} m²`,
      vacuum.cleaningMinutes === null ? "" : `${vacuum.cleaningMinutes} min`,
    ].filter(Boolean).join(" · ")
    : "";

  return (
    <section className="home-feature-card vacuum-card">
      <div className="home-section-title">
        <div><span>Roborock</span><h2>Vacuum</h2></div>
        {vacuum.battery !== null && <strong>{vacuum.charging && <BatteryCharging aria-hidden="true" />}{Math.round(vacuum.battery)}% battery</strong>}
      </div>
      <div className="vacuum-body">
        <VacuumMap version={vacuum.mapVersion} />
        <div className="vacuum-controls">
          <div className={`vacuum-status tone-${headline.tone}`} role="status">
            <span>{headline.tone === "problem" ? <AlertTriangle aria-hidden="true" /> : headline.tone === "busy" ? <Play aria-hidden="true" /> : <House aria-hidden="true" />}</span>
            <div><strong>{headline.title}</strong>{headline.detail && <small>{headline.detail}</small>}</div>
          </div>
          <div className="vacuum-actions" role="group" aria-label="Vacuum controls">
            {/* Start resumes a paused clean, whichever rooms it was doing. */}
            {button("start", vacuum.state === "paused" ? "Resume" : "Full clean", Play, true)}
            {button("clean_area", "Living room & kitchen", Sofa)}
            {button("pause", "Pause", Pause)}
            {button("return_to_base", "Return to dock", House)}
          </div>
          {error && <p className="home-feature-warning" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>}
          {(consumables.length > 0 || vacuum.waterShortage) && (
            <ul className="home-feature-facts vacuum-attention">
              {vacuum.waterShortage && <li><Droplets aria-hidden="true" />Water tank is empty</li>}
              {consumables.map((item) => <li key={item.key}><Wrench aria-hidden="true" />{consumableLabel(item)}</li>)}
            </ul>
          )}
          {lastClean && <p className="vacuum-last-clean">{lastClean}</p>}
        </div>
      </div>
    </section>
  );
}

// A docked vacuum's map version can stay the same for days, so a map that
// failed to load (Home Assistant restarting, say) is asked for again.
const MAP_RETRY_MS = 60_000;

function VacuumMap({ version }: { version: string | null }) {
  const [attempt, setAttempt] = useState(0);
  const src = `/api/vacuum/map?v=${encodeURIComponent(version ?? "none")}&attempt=${attempt}`;
  const [failedSrc, setFailedSrc] = useState("");
  const [crop, setCrop] = useState<string | undefined>(undefined);
  const failed = failedSrc === src;
  useEffect(() => {
    if (!failed) return;
    const timer = window.setTimeout(() => setAttempt((count) => count + 1), MAP_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [failed]);
  if (failed) {
    return <div className="vacuum-map is-empty"><MapIcon aria-hidden="true" /><span>No map yet</span></div>;
  }
  return (
    <div className="vacuum-map">
      <img
        src={src}
        alt="Map of the house from the vacuum"
        // Chromium-only, so it isn't in React's style types.
        style={crop ? { objectViewBox: crop } as CSSProperties : undefined}
        onLoad={(event) => setCrop(mapCrop(event.currentTarget))}
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}

/**
 * Roborock maps leave a wide transparent border around the house. Find the
 * drawn part and zoom to it with object-view-box. Undefined shows it all.
 */
function mapCrop(image: HTMLImageElement): string | undefined {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return undefined;
  const scale = Math.min(1, 320 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let top = canvas.height;
  let left = canvas.width;
  let bottom = -1;
  let right = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * 4 + 3] < 24) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }
  if (right < 0) return undefined;
  const margin = 0.05 * Math.max(right - left, bottom - top);
  const inset = (value: number) => `${Math.max(0, Math.round(value / scale))}px`;
  return `inset(${inset(top - margin)} ${inset(canvas.width - right - 1 - margin)} ${inset(canvas.height - bottom - 1 - margin)} ${inset(left - margin)})`;
}
