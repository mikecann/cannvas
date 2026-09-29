import { BatteryMedium, BatteryWarning, CloudRain, Droplets, Gauge, LoaderCircle, Square, Sun } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorText, readJsonResponse } from "../lib/http";
import {
  batteryLabel,
  dialBlocksWatering,
  minutesLeftLabel,
  type ReticStatus,
  type ReticZone,
  zoneMinutesLeft,
} from "../lib/retic";
import { useRetic } from "../lib/useRetic";

type Pending = { entityId: string; kind: "start" | "stop" };

// Home Assistant opens or closes the valve a second or two after the request.
const REFRESH_AFTER_MS = [1500, 4000];
const PENDING_LIMIT_MS = 10_000;

export function ReticApp() {
  const { state, refresh } = useRetic(5000);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // Clear the spinner as soon as the controller reports the change.
  const retic = state.kind === "ready" ? state.retic : null;
  useEffect(() => {
    if (!pending || !retic) return;
    const zone = retic.zones?.find(({ entityId }) => entityId === pending.entityId);
    if (zone && zone.open === (pending.kind === "start")) setPending(null);
  }, [pending, retic]);

  async function send(path: string, body: object, next: Pending) {
    setError(null);
    setPending(next);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await readJsonResponse(response, "The retic controller did not respond");
      timers.current.push(...REFRESH_AFTER_MS.map((delay) => window.setTimeout(() => void refresh(), delay)));
      timers.current.push(window.setTimeout(() => setPending((current) => (current === next ? null : current)), PENDING_LIMIT_MS));
    } catch (requestError) {
      setError(errorText(requestError, "The retic controller did not respond"));
      setPending(null);
    }
  }

  const run = (zone: ReticZone, minutes: number) => send("/api/retic/run", { entityId: zone.entityId, minutes }, { entityId: zone.entityId, kind: "start" });
  const stop = (zone: ReticZone) => send("/api/retic/stop", { entityId: zone.entityId }, { entityId: zone.entityId, kind: "stop" });

  return (
    <section className="retic-app">
      <header className="retic-header">
        <div>
          <p className="eyebrow">Retic</p>
          <h1>Garden watering</h1>
        </div>
        {retic?.configured && <ReticStatusPill retic={retic} />}
      </header>

      {state.kind === "loading" && <div className="retic-message">Checking the controller…</div>}
      {state.kind === "error" && <div className="retic-message">{state.message}</div>}
      {retic && !retic.configured && <div className="retic-message">Connect Home Assistant in Home controls to use the retic.</div>}
      {retic?.configured && (
        <>
          {error && <div className="retic-alert error" role="alert">{error}</div>}
          {!retic.available && (
            <div className="retic-alert">Home Assistant can't reach the controller right now. Check that it's plugged in and on Wi-Fi.</div>
          )}
          {retic.available && dialBlocksWatering(retic.dial) && (
            <div className="retic-alert">The dial on the controller is set to {retic.dial}. Turn it to RUN so zones can water.</div>
          )}
          <div className="retic-zones">
            {(retic.zones ?? []).map((zone) => (
              <ZoneCard
                key={zone.entityId}
                zone={zone}
                retic={retic}
                pending={pending?.entityId === zone.entityId ? pending.kind : null}
                busy={pending != null}
                onRun={(minutes) => void run(zone, minutes)}
                onStop={() => void stop(zone)}
              />
            ))}
          </div>
          <ControllerTiles retic={retic} />
        </>
      )}
    </section>
  );
}

function ReticStatusPill({ retic }: { retic: ReticStatus }) {
  const watering = retic.zones?.find((zone) => zone.open);
  const minutes = watering ? zoneMinutesLeft(retic, watering) : null;
  return (
    <div className={`retic-status-pill${watering ? " watering" : ""}${retic.available ? "" : " offline"}`}>
      <Droplets aria-hidden="true" />
      <span>
        <strong>{!retic.available ? "Offline" : watering ? watering.name : "All off"}</strong>
        {!retic.available ? "Controller not responding" : watering ? minutesLeftLabel(minutes) : "No zones watering"}
      </span>
    </div>
  );
}

function ZoneCard({ zone, retic, pending, busy, onRun, onStop }: {
  zone: ReticZone;
  retic: ReticStatus;
  pending: "start" | "stop" | null;
  busy: boolean;
  onRun: (minutes: number) => void;
  onStop: () => void;
}) {
  const unavailable = zone.state == null;
  const minutes = zoneMinutesLeft(retic, zone);
  const status = unavailable
    ? "Unavailable"
    : pending === "start" ? "Starting…"
    : pending === "stop" ? "Stopping…"
    : zone.open ? minutesLeftLabel(minutes)
    : "Off";

  return (
    <article className={`retic-zone${zone.open ? " open" : ""}${unavailable ? " unavailable" : ""}`}>
      <span className="retic-zone-number" aria-hidden="true">{zone.zone}</span>
      <div className="retic-zone-text">
        <h2>{zone.name}</h2>
        <p>{pending ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{status}</p>
      </div>
      <div className="retic-zone-actions">
        {zone.open ? (
          <button className="retic-stop" onClick={onStop} disabled={busy}>
            <Square aria-hidden="true" />
            Stop
          </button>
        ) : (
          (retic.runMinutes ?? []).map((value) => (
            <button key={value} className="retic-run" onClick={() => onRun(value)} disabled={busy || unavailable} aria-label={`Water ${zone.name} for ${value} minutes`}>
              <strong>{value}</strong>
              <small>min</small>
            </button>
          ))
        )}
      </div>
    </article>
  );
}

function ControllerTiles({ retic }: { retic: ReticStatus }) {
  const rain = retic.rainDetected;
  return (
    <div className="retic-tiles">
      <Tile
        icon={rain ? <CloudRain /> : <Sun />}
        label="Rain sensor"
        value={rain == null ? "Unknown" : rain ? "Wet" : "Dry"}
        note={rain ? "Rain detected" : "No rain detected"}
        tone={rain ? "wet" : undefined}
      />
      <Tile
        icon={retic.batteryLow ? <BatteryWarning /> : <BatteryMedium />}
        label="Backup battery"
        value={batteryLabel(retic)}
        note={retic.batteryVolts != null ? `9V battery at ${retic.batteryVolts.toFixed(1)} V` : "9V battery"}
        tone={retic.batteryLow ? "warn" : undefined}
      />
      <Tile
        icon={<Gauge />}
        label="Controller"
        value={retic.dial ?? "Unknown"}
        note={retic.mainsProblem ? "Mains power problem" : "Dial position"}
        tone={retic.mainsProblem || dialBlocksWatering(retic.dial) ? "warn" : undefined}
      />
    </div>
  );
}

function Tile({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note: string; tone?: "wet" | "warn" }) {
  return (
    <article className={`retic-tile${tone ? ` ${tone}` : ""}`}>
      <span className="retic-tile-icon" aria-hidden="true">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}
