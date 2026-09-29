import { BatteryMedium, BatteryWarning, CalendarClock, CircleHelp, CloudRain, Droplets, Gauge, LoaderCircle, Power, Square, Sun } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorText, readJsonResponse } from "../lib/http";
import {
  batteryLabel,
  dialBlocksWatering,
  formatMm,
  minutesLeftLabel,
  nextRunLabel,
  type ReticStatus,
  type ReticZone,
  scheduleLabel,
  skipReason,
  zoneMinutesLeft,
} from "../lib/retic";
import { useRetic } from "../lib/useRetic";

type Pending = { entityId: string; kind: "start" | "stop" };
const MASTER = "master";

// Home Assistant opens or closes the valve a second or two after the request.
const REFRESH_AFTER_MS = [1500, 4000];
const PENDING_LIMIT_MS = 10_000;

export function ReticApp() {
  const { state, refresh } = useRetic(5000);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const pendingRef = useRef<Pending | null>(null);

  useEffect(() => {
    pendingRef.current = pending;
  });

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // Clear the spinner as soon as the controller reports the change.
  const retic = state.kind === "ready" ? state.retic : null;
  useEffect(() => {
    if (!pending || !retic) return;
    if (pending.entityId === MASTER) {
      if (retic.enabled === (pending.kind === "start")) setPending(null);
      return;
    }
    const zone = retic.zones?.find(({ entityId }) => entityId === pending.entityId);
    if (zone && zone.open === (pending.kind === "start")) setPending(null);
  }, [pending, retic]);

  async function send(path: string, body: object, next: Pending) {
    setError(null);
    setPending(next);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PENDING_LIMIT_MS),
      });
      await readJsonResponse(response, "The retic controller did not respond");
      timers.current.push(...REFRESH_AFTER_MS.map((delay) => window.setTimeout(() => void refresh(), delay)));
      // Home Assistant accepts the request before the valve moves, so only
      // the valve's state shows whether it worked.
      timers.current.push(window.setTimeout(() => {
        if (pendingRef.current !== next) return;
        setPending(null);
        setError(next.entityId === MASTER
          ? "Home Assistant didn't change the retic switch. Try again."
          : next.kind === "start"
            ? "The zone didn't turn on. Check the controller and try again."
            : "The zone didn't turn off. Try Stop again, or press STOP on the controller.");
      }, PENDING_LIMIT_MS));
    } catch (requestError) {
      // A timed-out request throws a DOMException whose message means nothing to people.
      setError(requestError instanceof DOMException ? "The retic controller did not respond" : errorText(requestError, "The retic controller did not respond"));
      setPending(null);
    }
  }

  const run = (zone: ReticZone, minutes: number) => send("/api/retic/run", { entityId: zone.entityId, minutes }, { entityId: zone.entityId, kind: "start" });
  const stop = (zone: ReticZone) => send("/api/retic/stop", { entityId: zone.entityId }, { entityId: zone.entityId, kind: "stop" });
  const setEnabled = (enabled: boolean) => send("/api/retic/enabled", { enabled }, { entityId: MASTER, kind: enabled ? "start" : "stop" });

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
          <MasterSwitch
            enabled={retic.enabled ?? null}
            pending={pending?.entityId === MASTER}
            onChange={(enabled) => void setEnabled(enabled)}
          />
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
                // The script refuses to run while the retic is off or any
                // zone's state is unknown, because that zone might be open.
                blocked={retic.enabled !== true || (retic.zones ?? []).some(({ state }) => state == null)}
                onRun={(minutes) => void run(zone, minutes)}
                onStop={() => void stop(zone)}
              />
            ))}
          </div>
          <ScheduleCard retic={retic} />
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

function MasterSwitch({ enabled, pending, onChange }: { enabled: boolean | null; pending: boolean; onChange: (enabled: boolean) => void }) {
  const on = enabled === true;
  return (
    <div className={`retic-master${on ? " on" : " off"}`}>
      <span className="retic-master-icon" aria-hidden="true"><Power /></span>
      <div>
        <h2>{enabled == null ? "Retic switch unknown" : on ? "Retic is on" : "Retic is off"}</h2>
        <p>
          {enabled == null
            ? "Home Assistant can't read the master switch."
            : on
              ? "Zones can run, and the smart schedule waters on its days."
              : "Nothing will water, not even the schedule. Any zone that opens is closed."}
        </p>
      </div>
      <button
        className="retic-toggle"
        role="switch"
        aria-checked={on}
        aria-label="Retic master switch"
        disabled={pending || enabled == null}
        onClick={() => onChange(!on)}
      >
        <span />
      </button>
    </div>
  );
}

function ScheduleCard({ retic }: { retic: ReticStatus }) {
  const schedule = retic.schedule;
  if (!schedule || (!schedule.nextRun && schedule.days.length === 0)) return null;
  const skip = skipReason(retic);
  const next = retic.enabled === false
    ? "Paused while the retic is off"
    : schedule.running ? "Watering on schedule now" : nextRunLabel(schedule.nextRun);
  const outlook = retic.enabled === false || schedule.running || !schedule.nextRun
    ? null
    : skip ? `Would skip if it ran now: ${skip}` : "Will water unless it rains first";
  return (
    <article className="retic-schedule">
      <header>
        <span className="retic-tile-icon" aria-hidden="true"><CalendarClock /></span>
        <div>
          <span>Smart schedule</span>
          <h2>{scheduleLabel(schedule.days, schedule.start)}</h2>
        </div>
      </header>
      <div className="retic-schedule-next">
        <div>
          <span>Next</span>
          <strong>{next}</strong>
          {outlook && <small className={skip ? "skip" : undefined}>{outlook}</small>}
        </div>
        <div className="retic-rain">
          <div><span>Rain, 24 h</span><strong>{formatMm(schedule.rainLast24h)}</strong></div>
          <div><span>Forecast, 12 h</span><strong>{formatMm(schedule.rainNext12h)}</strong></div>
        </div>
      </div>
      <p>
        Skips when {schedule.skipPastMm ?? 3} mm or more fell in the last 24 hours, {schedule.skipForecastMm ?? 5} mm or more is
        forecast, or the rain sensor is wet.
        {schedule.lastResult && <><br /><strong>Last time:</strong> {schedule.lastResult}</>}
      </p>
    </article>
  );
}

function ZoneCard({ zone, retic, pending, busy, blocked, onRun, onStop }: {
  zone: ReticZone;
  retic: ReticStatus;
  pending: "start" | "stop" | null;
  busy: boolean;
  blocked: boolean;
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
            <button key={value} className="retic-run" onClick={() => onRun(value)} disabled={busy || blocked} aria-label={`Water ${zone.name} for ${value} minutes`}>
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
        icon={rain ? <CloudRain /> : rain == null ? <CircleHelp /> : <Sun />}
        label="Rain sensor"
        value={rain == null ? "Unknown" : rain ? "Wet" : "Dry"}
        note={rain == null ? "Can't read the sensor" : rain ? "Rain detected" : "No rain detected"}
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
