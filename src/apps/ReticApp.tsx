import { CircleCheck, Info, ListX, LoaderCircle, Minus, Plus, RotateCcw, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, readJsonResponse } from "../lib/http";
import {
  editQueue,
  formatMm,
  minutesLeftLabel,
  perthDate,
  predictedSkip,
  type ReticOutlook,
  reticOutlook,
  type ReticQueueEdit,
  type ReticQueueItem,
  type ReticStatus,
  type ReticZone,
  type ReticScheduleDraft,
  type RunMark,
  runMarks,
  sameSchedule,
  scheduleDraft,
  scheduleLabel,
  startLabel,
  tapEdit,
  totalMinutes,
  zoneMinutesLeft,
} from "../lib/retic";
import { dailyRain, type HourlyRain, rainAroundRun } from "../lib/reticRain";
import { useRetic } from "../lib/useRetic";
import { useReticRain } from "../lib/useReticRain";

type QueueEdit = { id: number; edit: ReticQueueEdit };

// Home Assistant opens or closes the valve a second or two after the request.
const REFRESH_AFTER_MS = [1500, 4000];
const PENDING_LIMIT_MS = 10_000;

export function ReticApp() {
  const { state, refresh } = useRetic(5000);
  const rain = useReticRain();
  // Edits sent but not yet seen in a refresh, laid over the queue so taps show at once.
  const [edits, setEdits] = useState<QueueEdit[]>([]);
  // The zone a tap is starting, until it opens.
  const [starting, setStarting] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // The state the master switch is being moved to, until Home Assistant reports it.
  const [switchPending, setSwitchPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const nextEdit = useRef(0);
  // Requests go one at a time, in the order they were tapped.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef({ starting, stopping, switchPending });

  useEffect(() => {
    waiting.current = { starting, stopping, switchPending };
  });

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  // Clear each spinner as soon as the controller reports the change.
  const retic = state.kind === "ready" ? state.retic : null;
  const anyOpen = (retic?.zones ?? []).some(({ open }) => open);
  useEffect(() => {
    if (!retic) return;
    if (switchPending != null && retic.enabled === switchPending) setSwitchPending(null);
    if (starting && retic.zones?.some(({ entityId, open }) => open && entityId === starting)) setStarting(null);
    if (stopping && !anyOpen && !retic.queue?.length) setStopping(false);
  }, [retic, anyOpen, starting, stopping, switchPending]);

  /** Refreshes while Home Assistant moves the valve, and says so if nothing happens. */
  function watch(stillWaiting: () => boolean, giveUp: () => void, message: string) {
    timers.current.push(...REFRESH_AFTER_MS.map((delay) => window.setTimeout(() => void refresh(), delay)));
    timers.current.push(window.setTimeout(() => {
      if (!stillWaiting()) return;
      giveUp();
      setError(message);
    }, PENDING_LIMIT_MS));
  }

  /** Sends a request, showing any failure. Home Assistant accepts it before the valve moves. */
  async function post(path: string, body: object) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(PENDING_LIMIT_MS),
      });
      await readJsonResponse(response, "The retic controller did not respond");
      return true;
    } catch (requestError) {
      // A timed-out request throws a DOMException whose message means nothing to people.
      setError(requestError instanceof DOMException ? "The retic controller did not respond" : errorText(requestError, "The retic controller did not respond"));
      return false;
    }
  }

  const running = (retic?.queueRunning ?? false) || starting != null;
  const queue = edits.reduce((current, { edit }) => editQueue(current, edit, running), retic?.queue ?? []);

  function changeQueue(edit: ReticQueueEdit) {
    setError(null);
    const id = nextEdit.current++;
    setEdits((current) => [...current, { id, edit }]);
    // The first zone into an empty queue starts watering straight away.
    const starts = edit.action === "add" && !running && queue.length === 0;
    if (starts) {
      setStarting(edit.entityId);
      watch(() => waiting.current.starting === edit.entityId, () => setStarting(null), "The zone didn't turn on. Check the controller and try again.");
    }
    chain.current = chain.current.then(async () => {
      const sent = edit.action === "add"
        ? await post("/api/retic/run", { entityId: edit.entityId, minutes: edit.minutes })
        : await post("/api/retic/queue", edit);
      if (!sent && starts) setStarting(null);
      await refresh();
      setEdits((current) => current.filter((pending) => pending.id !== id));
    });
  }

  function stop() {
    setError(null);
    setStopping(true);
    setStarting(null);
    watch(() => waiting.current.stopping, () => setStopping(false), "The retic didn't stop. Try Stop again, or press STOP on the controller.");
    chain.current = chain.current.then(async () => {
      if (!await post("/api/retic/stop", {})) setStopping(false);
      await refresh();
    });
  }

  async function setEnabled(enabled: boolean) {
    setError(null);
    setSwitchPending(enabled);
    if (!await post("/api/retic/enabled", { enabled })) {
      setSwitchPending(null);
      return;
    }
    watch(() => waiting.current.switchPending === enabled, () => setSwitchPending(null), "Home Assistant didn't change the retic switch. Try again.");
  }

  // Zones waiting behind the one watering.
  const waitingCount = running ? Math.max(queue.length - 1, 0) : queue.length;

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
            switchPending={switchPending}
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
                queue={queue}
                running={running}
                starting={starting === zone.entityId}
                // The script refuses to run while the retic is off or any
                // zone's state is unknown, because that zone might be open.
                blocked={stopping || retic.enabled !== true || (retic.zones ?? []).some(({ state }) => state == null)}
                onTap={(minutes) => changeQueue(tapEdit(queue, zone.entityId, minutes))}
              />
            ))}
          </div>
          {/* Under the zones, so it showing up never moves a button about to be tapped. */}
          {(anyOpen || queue.length > 0 || stopping) && (
            <div className="retic-queue-actions">
              {waitingCount > 0 && (
                <button className="retic-clear" onClick={() => changeQueue({ action: "clear" })} disabled={stopping}>
                  <ListX aria-hidden="true" />
                  Clear queue
                </button>
              )}
              <button className="retic-stop" onClick={stop} disabled={stopping}>
                {stopping ? <LoaderCircle className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}
                {stopping ? "Stopping…" : "Stop watering"}
              </button>
            </div>
          )}
          <HealthLine retic={retic} />
          {infoOpen && <ScheduleInfo retic={retic} rain={rain} refresh={refresh} onClose={() => setInfoOpen(false)} />}
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
  const outlook: ReticOutlook = reticOutlook(retic, runRain, Date.now(), rain != null);
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

function ZoneRow({ zone, retic, queue, running, starting, blocked, onTap }: {
  zone: ReticZone;
  retic: ReticStatus;
  queue: ReticQueueItem[];
  /** The queue's first zone is watering, so it can only be stopped. */
  running: boolean;
  starting: boolean;
  blocked: boolean;
  onTap: (minutes: number) => void;
}) {
  const unavailable = zone.state == null;
  const place = queue.findIndex(({ entityId }) => entityId === zone.entityId);
  const queued = place >= 0 ? queue[place] : null;
  const locked = starting || (running && place === 0);
  const status = unavailable
    ? "Unavailable"
    : starting ? "Starting…"
    : zone.open ? minutesLeftLabel(zoneMinutesLeft(retic, zone))
    : null;

  return (
    <article className={`retic-zone${zone.open ? " open" : ""}${unavailable ? " unavailable" : ""}`}>
      <span className="retic-zone-number" aria-hidden="true">{zone.zone}</span>
      <div className="retic-zone-text">
        <h2>{zone.name}</h2>
        {status && <p>{starting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{status}</p>}
      </div>
      <div className="retic-zone-actions">
        {(retic.runMinutes ?? []).map((value) => {
          const picked = queued?.minutes === value;
          return (
            <button
              key={value}
              className={`retic-run${picked ? " picked" : ""}`}
              onClick={() => onTap(value)}
              disabled={blocked || locked}
              aria-label={picked
                ? `${zone.name} for ${value} minutes, number ${place + 1} in the queue. Tap to take it out.`
                : `Water ${zone.name} for ${value} minutes`}
            >
              <strong>{value}</strong>
              <small>min</small>
              {picked && <span className="retic-run-place" aria-hidden="true">{place + 1}</span>}
            </button>
          );
        })}
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

function ScheduleInfo({ retic, rain, refresh, onClose }: {
  retic: ReticStatus;
  rain: HourlyRain | null;
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const schedule = retic.schedule;
  const runRain = rain ? rainAroundRun(rain, schedule?.nextRun ?? null) : null;
  const names = new Map((retic.zones ?? []).map(({ entityId, name }) => [entityId, name]));
  const order = schedule?.zones ?? [];
  return (
    <div className="dialog-backdrop" role="presentation" onPointerDown={onClose}>
      <section className={`dialog-card retic-info-card${editing ? " editing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="retic-info-title" onPointerDown={(event) => event.stopPropagation()}>
        {editing ? <ScheduleEditor retic={retic} refresh={refresh} onDone={() => setEditing(false)} /> : (
          <>
            <h2 id="retic-info-title">{schedule ? scheduleLabel(schedule.days, schedule.start) : "No schedule"}</h2>
            <p>
              September to May: {order.map(({ entityId, minutes }, index) => `${index === 0 ? "" : "then "}${(names.get(entityId) ?? entityId).toLowerCase()} for ${minutes ?? "?"} min`).join(", ")}.
              {order.length > 0 && ` ${totalMinutes(order)} min in all.`}
            </p>
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
            <div className="retic-info-actions">
              <button className="button secondary" onClick={() => setEditing(true)} disabled={!schedule || !retic.startTimes?.length}>Change schedule</button>
              <button className="button primary" onClick={onClose}>Got it</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// Home Assistant saves at once, but the schedule only shows once the next poll reads it back.
const SAVE_LIMIT_MS = 10_000;

/** The schedule's start time and zones, picked the same way as the queue: tap zones in the order to water them. */
function ScheduleEditor({ retic, refresh, onDone }: { retic: ReticStatus; refresh: () => Promise<void>; onDone: () => void }) {
  const saved = scheduleDraft(retic.schedule);
  const [draft, setDraft] = useState<ReticScheduleDraft>(saved);
  // The draft being saved, until a refresh shows Home Assistant has it.
  const [saving, setSaving] = useState<ReticScheduleDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const times = retic.startTimes ?? [];
  const at = times.indexOf(draft.start);
  const minutes = totalMinutes(draft.zones);
  const busy = saving != null;

  useEffect(() => {
    if (saving && sameSchedule(saving, saved)) onDone();
  });

  useEffect(() => {
    if (!saving) return;
    const timer = window.setTimeout(() => {
      setSaving(null);
      setError("Home Assistant didn't save the schedule. Try again.");
    }, SAVE_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [saving]);

  async function save() {
    setError(null);
    setSaving(draft);
    try {
      await readJsonResponse(await fetch("/api/retic/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
        signal: AbortSignal.timeout(SAVE_LIMIT_MS),
      }), "Home Assistant didn't answer");
      await refresh();
    } catch (requestError) {
      setSaving(null);
      setError(requestError instanceof DOMException ? "Home Assistant didn't answer" : errorText(requestError, "Home Assistant didn't answer"));
    }
  }

  // A start the page doesn't offer (set some other way) snaps to the nearest one it does.
  function step(by: number) {
    const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    const nearest = times.reduce((best, time, index) => (Math.abs(minutesOf(time) - minutesOf(draft.start)) < Math.abs(minutesOf(times[best]) - minutesOf(draft.start)) ? index : best), 0);
    const next = at >= 0 ? times[Math.min(Math.max(at + by, 0), times.length - 1)] : times[nearest];
    if (next) setDraft({ ...draft, start: next });
  }

  return (
    <>
      <h2 id="retic-info-title">Change the schedule</h2>
      <div className="retic-edit-start">
        <span>Starts</span>
        <div className="car-stepper">
          <button aria-label="Earlier" disabled={busy || at === 0} onClick={() => step(-1)}><Minus /></button>
          <strong>{startLabel(draft.start)}</strong>
          <button aria-label="Later" disabled={busy || at === times.length - 1} onClick={() => step(1)}><Plus /></button>
        </div>
      </div>
      <p className="retic-edit-hint">Tap zones in the order to water them.</p>
      <div className="retic-edit-zones">
        {(retic.zones ?? []).map((zone) => {
          const place = draft.zones.findIndex(({ entityId }) => entityId === zone.entityId);
          return (
            <div key={zone.entityId} className={`retic-edit-zone${place < 0 ? " left-out" : ""}`}>
              <h3>{zone.name}</h3>
              <div className="retic-zone-actions">
                {(retic.runMinutes ?? []).map((value) => {
                  const picked = place >= 0 && draft.zones[place].minutes === value;
                  return (
                    <button
                      key={value}
                      className={`retic-run${picked ? " picked" : ""}`}
                      disabled={busy}
                      onClick={() => setDraft({ ...draft, zones: editQueue(draft.zones, tapEdit(draft.zones, zone.entityId, value), false) })}
                      aria-label={picked
                        ? `${zone.name} for ${value} minutes, number ${place + 1} in the schedule. Tap to leave it out.`
                        : `${zone.name} for ${value} minutes`}
                    >
                      <strong>{value}</strong>
                      <small>min</small>
                      {picked && <span className="retic-run-place" aria-hidden="true">{place + 1}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="retic-edit-summary">
        {draft.zones.length === 0
          ? "Pick at least one zone"
          : `${draft.zones.length} ${draft.zones.length === 1 ? "zone" : "zones"}, ${minutes} min, done about ${startLabel(draft.start, minutes)}`}
        {draft.zones.length > 0 && (
          <button className="retic-edit-reset" onClick={() => setDraft({ ...draft, zones: [] })} disabled={busy}>
            <RotateCcw aria-hidden="true" />
            Start again
          </button>
        )}
      </p>
      {error && <p className="retic-edit-error" role="alert">{error}</p>}
      <div className="retic-info-actions">
        <button className="button secondary" onClick={onDone} disabled={busy}>Cancel</button>
        <button className="button primary" onClick={() => void save()} disabled={busy || draft.zones.length === 0 || at < 0 || sameSchedule(draft, saved)}>
          {busy && <LoaderCircle className="spin" aria-hidden="true" />}
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}
