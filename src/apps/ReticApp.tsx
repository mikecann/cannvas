import { CircleCheck, Info, LoaderCircle, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, readJsonResponse } from "../lib/http";
import {
  formatMm,
  minutesLeftLabel,
  perthDate,
  predictedSkip,
  type ReticOutlook,
  reticOutlook,
  type ReticStatus,
  type ReticZone,
  type RunMark,
  runMarks,
  scheduleLabel,
  zoneMinutesLeft,
} from "../lib/retic";
import { dailyRain, type HourlyRain, rainAroundRun } from "../lib/reticRain";
import { useRetic } from "../lib/useRetic";
import { useReticRain } from "../lib/useReticRain";

type Pending = { entityId: string; kind: "start" | "stop" };
const MASTER = "master";

// Home Assistant opens or closes the valve a second or two after the request.
const REFRESH_AFTER_MS = [1500, 4000];
const PENDING_LIMIT_MS = 10_000;

export function ReticApp() {
  const { state, refresh } = useRetic(5000);
  const rain = useReticRain();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
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
      <h1>Garden watering</h1>

      {state.kind === "loading" && <div className="retic-message">Checking the controller…</div>}
      {state.kind === "error" && <div className="retic-message">{state.message}</div>}
      {retic && !retic.configured && <div className="retic-message">Connect Home Assistant in Home controls to use the retic.</div>}
      {retic?.configured && (
        <>
          <AnswerCard
            retic={retic}
            rain={rain}
            switchPending={pending?.entityId === MASTER ? pending.kind === "start" : null}
            onSwitch={(enabled) => void setEnabled(enabled)}
            onInfo={() => setInfoOpen(true)}
          />
          {error && <div className="retic-alert error" role="alert">{error}</div>}
          {retic.available && (retic.zones ?? []).some(({ state }) => state == null) && (
            <div className="retic-alert">
              Home Assistant can't read {(retic.zones ?? []).filter(({ state }) => state == null).map(({ name }) => name).join(", ")}.
              Runs are paused in case it's still watering.
            </div>
          )}
          <div className="retic-zones">
            {(retic.zones ?? []).map((zone) => (
              <ZoneRow
                key={zone.entityId}
                zone={zone}
                retic={retic}
                pending={pending?.entityId === zone.entityId ? pending.kind : null}
                busy={pending != null}
                // The script refuses to run while the retic is off or any
                // zone's state is unknown, because that zone might be open.
                blocked={retic.enabled !== true || (retic.zones ?? []).some(({ state }) => state == null)}
                watering={(retic.zones ?? []).some(({ open }) => open)}
                onRun={(minutes) => void run(zone, minutes)}
                onStop={() => void stop(zone)}
              />
            ))}
          </div>
          <HealthLine retic={retic} />
          {infoOpen && <ScheduleInfo retic={retic} rain={rain} onClose={() => setInfoOpen(false)} />}
        </>
      )}
    </section>
  );
}

function AnswerCard({ retic, rain, switchPending, onSwitch, onInfo }: {
  retic: ReticStatus;
  rain: HourlyRain | null;
  /** The state the switch is being moved to, or null. */
  switchPending: boolean | null;
  onSwitch: (enabled: boolean) => void;
  onInfo: () => void;
}) {
  const runRain = rain ? rainAroundRun(rain, retic.schedule?.nextRun ?? null) : null;
  const outlook: ReticOutlook = reticOutlook(retic, runRain);
  const willSkip = predictedSkip(retic, runRain) != null;
  return (
    <article className={`retic-answer ${outlook.tone}`}>
      <div className="retic-answer-top">
        <div>
          <h2>{outlook.headline}</h2>
          <p>
            {outlook.detail}
            <button className="retic-info" onClick={onInfo} aria-label="How the schedule works"><Info aria-hidden="true" /></button>
          </p>
        </div>
        <MasterSwitch enabled={retic.enabled ?? null} pending={switchPending} onChange={onSwitch} />
      </div>
      <RainChart rain={rain} marks={runMarks(retic, willSkip)} />
    </article>
  );
}

function MasterSwitch({ enabled, pending, onChange }: { enabled: boolean | null; pending: boolean | null; onChange: (enabled: boolean) => void }) {
  // Moves straight away while Home Assistant catches up, with a spinner in the knob.
  const on = pending ?? enabled === true;
  return (
    <button
      className="retic-toggle"
      role="switch"
      aria-checked={on}
      aria-label="Retic master switch"
      disabled={pending != null || enabled == null}
      onClick={() => onChange(!on)}
    >
      <em>{on ? "On" : "Off"}</em>
      <span>{pending != null && <LoaderCircle className="spin" aria-hidden="true" />}</span>
    </button>
  );
}

// The graph: the last three weeks, today and the next three days.
const PAST_DAYS = 21;
const AHEAD_DAYS = 3;
const CHART = { width: 932, plot: 850, top: 30, height: 220, max: 20, bar: 22 };

const MARK_LABELS: [RunMark, string][] = [["watered", "Watered"], ["stopped", "Stopped early"], ["skipped", "Skipped"], ["next", "Next"]];

function RainChart({ rain, marks }: { rain: HourlyRain | null; marks: Map<string, RunMark> }) {
  const now = Date.now();
  const today = perthDate(now);
  const totals = new Map((rain ? dailyRain(rain, now) : []).map(({ date, mm }) => [date, mm]));
  // Noon keeps each step on the right date whatever the time of day.
  const noon = Date.parse(`${today}T12:00:00+08:00`);
  const days = Array.from({ length: PAST_DAYS + 1 + AHEAD_DAYS }, (_, index) => {
    const time = noon + (index - PAST_DAYS) * 86_400_000;
    const date = perthDate(time);
    return { date, time, mm: totals.get(date) ?? null, forecast: date > today, monday: new Date(time).getUTCDay() === 1 };
  });
  const column = CHART.plot / days.length;
  const base = CHART.top + CHART.height;
  const todayIndex = PAST_DAYS;
  const shown = new Set(MARK_LABELS.map(([kind]) => kind).filter((kind) => [...marks.values()].some((mark) => mark === kind || (kind === "next" && mark === "next-skip"))));

  return (
    <div className="retic-chart">
      <svg viewBox={`0 0 ${CHART.width} ${base + 96}`} role="img" aria-label="Rain each day for the last three weeks and the next three, with the schedule's runs">
        {/* Shared by every "stopped early" mark, including the legend's. */}
        <defs><clipPath id="retic-half-drop"><rect x="0" y="12.5" width="24" height="12" /></clipPath></defs>
        <rect className="today-band" x={todayIndex * column + 1} y={4} width={column - 2} height={base + 64} rx={12} />
        <rect className="forecast-box" x={(todayIndex + 1) * column + 1} y={CHART.top - 10} width={CHART.plot - (todayIndex + 1) * column - 2} height={CHART.height + 10} rx={10} />
        {[10, 20].map((value) => {
          const y = base - (value / CHART.max) * CHART.height;
          return (
            <g key={value}>
              <line className="grid" x1={0} x2={CHART.plot} y1={y} y2={y} />
              <text className="axis" x={CHART.plot + 10} y={y + 6}>{value} mm</text>
            </g>
          );
        })}
        <line className="baseline" x1={0} x2={CHART.plot} y1={base} y2={base} />
        {days.map((day, index) => {
          const x = index * column + (column - CHART.bar) / 2;
          const mark = marks.get(day.date);
          const label = day.monday && Math.abs(index - todayIndex) > 2
            ? new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Perth", day: "numeric", month: "short" }).format(day.time)
            : null;
          const height = day.mm && day.mm > 0 ? Math.max(4, (Math.min(day.mm, CHART.max) / CHART.max) * CHART.height) : 0;
          return (
            <g key={day.date}>
              {day.monday && index > 0 && <line className="week" x1={index * column} x2={index * column} y1={CHART.top - 6} y2={base} />}
              {height > 0 && <rect className={day.forecast ? "bar forecast" : "bar"} x={x} y={base - height} width={CHART.bar} height={height} rx={5} />}
              {day.mm != null && day.mm >= 3 && <text className="value" x={x + CHART.bar / 2} y={base - height - 9} textAnchor="middle">{formatMm(day.mm).replace(" mm", "")}</text>}
              {mark ? <MarkIcon kind={mark} x={index * column + column / 2} y={base + 30} /> : <circle className="dot" cx={index * column + column / 2} cy={base + 8} r={1.6} />}
              {label && <text className="week-label" x={index * column + 4} y={base + 86}>{label}</text>}
            </g>
          );
        })}
        <rect className="today-pill" x={todayIndex * column + column / 2 - 38} y={base + 64} width={76} height={30} rx={15} />
        <text className="today-label" x={todayIndex * column + column / 2} y={base + 85} textAnchor="middle">Today</text>
      </svg>
      {shown.size > 0 && (
        <div className="retic-legend">
          {MARK_LABELS.filter(([kind]) => shown.has(kind)).map(([kind, label]) => (
            <span key={kind}><svg viewBox="0 0 24 24" aria-hidden="true"><MarkPaths kind={kind} /></svg>{label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const DROP = "M12 3.5c3 3.6 5.5 6.6 5.5 9.9A5.5 5.5 0 0 1 6.5 13.4C6.5 10.1 9 7.1 12 3.5Z";
const SMALL_DROP = "M12 6.5c1.9 2.3 3.4 4.1 3.4 6.1a3.4 3.4 0 0 1-6.8 0c0-2 1.5-3.8 3.4-6.1Z";

function MarkIcon({ kind, x, y }: { kind: RunMark; x: number; y: number }) {
  return (
    <svg x={x - 17} y={y - 17} width={34} height={34} viewBox="0 0 24 24">
      <MarkPaths kind={kind} />
    </svg>
  );
}

/** Filled drop: watered. Half drop: stopped early. Struck drop: skipped. Ringed drop: next or running. */
function MarkPaths({ kind }: { kind: RunMark }) {
  switch (kind) {
    case "watered":
      return <path className="mark fill" d={DROP} />;
    case "stopped":
      return (
        <>
          <path className="mark solid" d={DROP} clipPath="url(#retic-half-drop)" />
          <path className="mark" d={DROP} />
        </>
      );
    case "skipped":
      return <><path className="mark muted" d={DROP} /><path className="mark muted" d="M5 5l14 14" /></>;
    case "next":
      return <><circle className="mark dashed" cx="12" cy="12" r="10.5" /><path className="mark" d={SMALL_DROP} /></>;
    case "next-skip":
      return <><circle className="mark dashed muted" cx="12" cy="12" r="10.5" /><path className="mark muted" d={SMALL_DROP} /><path className="mark muted" d="M7 7l10 10" /></>;
    case "running":
      return <><circle className="mark" cx="12" cy="12" r="10.5" /><path className="mark fill" d={SMALL_DROP} /></>;
  }
}

function ZoneRow({ zone, retic, pending, busy, blocked, watering, onRun, onStop }: {
  zone: ReticZone;
  retic: ReticStatus;
  pending: "start" | "stop" | null;
  busy: boolean;
  blocked: boolean;
  /** Another zone is watering, so these buttons would switch to this one. */
  watering: boolean;
  onRun: (minutes: number) => void;
  onStop: () => void;
}) {
  const unavailable = zone.state == null;
  const status = unavailable
    ? "Unavailable"
    : pending === "start" ? "Starting…"
    : pending === "stop" ? "Stopping…"
    : zone.open ? minutesLeftLabel(zoneMinutesLeft(retic, zone))
    : null;

  return (
    <article className={`retic-zone${zone.open ? " open" : ""}${unavailable ? " unavailable" : ""}${watering && !zone.open ? " quiet" : ""}`}>
      <span className="retic-zone-number" aria-hidden="true">{zone.zone}</span>
      <div className="retic-zone-text">
        <h2>{zone.name}</h2>
        {status && <p>{pending ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{status}</p>}
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

/** The controller's own readings in one quiet line, which turns amber when one needs attention. */
function HealthLine({ retic }: { retic: ReticStatus }) {
  const rain = retic.rainDetected == null ? "Rain sensor unknown" : retic.rainDetected ? "Rain sensor wet" : "Rain sensor dry";
  const battery = retic.batteryLow ? "Backup battery low, replace the 9V"
    : retic.batteryVolts != null ? `Battery ${retic.batteryVolts.toFixed(1)} V`
    : "Battery unknown";
  const dial = `Dial on ${retic.dial ?? "unknown"}`;
  // A dial off RUN is the headline whenever it matters, so it isn't flagged twice.
  const problem = retic.batteryLow || retic.mainsProblem || retic.rainDetected == null;
  const parts = [rain, battery, dial, ...(retic.mainsProblem ? ["Mains power problem"] : [])];
  return (
    <p className={`retic-health${problem ? " warn" : ""}`}>
      {problem ? <TriangleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
      {parts.join(" · ")}
    </p>
  );
}

function ScheduleInfo({ retic, rain, onClose }: { retic: ReticStatus; rain: HourlyRain | null; onClose: () => void }) {
  const schedule = retic.schedule;
  const runRain = rain ? rainAroundRun(rain, schedule?.nextRun ?? null) : null;
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section className="dialog-card retic-info-card" role="dialog" aria-modal="true" aria-labelledby="retic-info-title" onPointerDown={(event) => event.stopPropagation()}>
        <h2 id="retic-info-title">{schedule ? scheduleLabel(schedule.days, schedule.start) : "No schedule"}</h2>
        <p>September to May, all five zones in turn.</p>
        <p>
          It skips when {schedule?.skipPastMm ?? 3} mm or more fell in the 24 hours before, {schedule?.skipForecastMm ?? 5} mm or more is
          forecast for the 12 hours after, or the rain sensor is wet. Home Assistant decides at the start time.
        </p>
        <dl>
          <div><dt>Rain, last 24 hours</dt><dd>{formatMm(schedule?.rainLast24h)}</dd></div>
          <div><dt>Forecast, next 12 hours</dt><dd>{formatMm(schedule?.rainNext12h)}</dd></div>
          {runRain && <div><dt>24 hours before the next run</dt><dd>{formatMm(runRain.before)}</dd></div>}
          {runRain && <div><dt>12 hours after it starts</dt><dd>{formatMm(runRain.after)}</dd></div>}
        </dl>
        {schedule?.lastResult && <p><strong>Last time:</strong> {schedule.lastResult}</p>}
        <button className="button primary" onClick={onClose}>Got it</button>
      </section>
    </div>
  );
}
