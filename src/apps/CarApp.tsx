import { BatteryCharging, Car, ChevronDown, Info, LoaderCircle, Minus, Plus, Power, Settings, Sun, Zap } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { CAR_MODES, CAR_SETTING_RANGES, CAR_SETTING_STEP, type CarHistory, type CarMode, type CarSettingKey, type CarStatus, carHeadline, useCar, useCarHistory } from "../lib/car";
import { type ChargePlan, chargePlan, formatClock, formatDuration } from "../lib/carPlan";
import { errorText, readJsonResponse } from "../lib/http";
import { formatKwh } from "../lib/solar";
import { useMinuteClock } from "../lib/useMinuteClock";
import { useSunTimes } from "../lib/useSunTimes";

// The car's own page: its battery, what the garage plug is doing, and the
// numbers Home Assistant's charging rules use (deploy/home-assistant/car_charging.yaml).
export function CarApp() {
  const car = useCar(5000);
  const history = useCarHistory();
  const now = useMinuteClock();
  const { sunset } = useSunTimes(now);
  const status = car.state.kind === "ready" ? car.state.car : null;
  const plan = status ? chargePlan(status, now, sunset) : null;

  return (
    <section className="car-app">
      <h1>Car</h1>
      {car.state.kind === "loading" && <div className="car-message">Checking the car…</div>}
      {car.state.kind === "error" && <div className="car-message">{car.state.message}</div>}
      {status && !status.configured && <div className="car-message">Connect Home Assistant in Home controls to see the car.</div>}
      {status?.configured && (
        <>
          <CarBattery car={status} plan={plan} now={now} />
          <CarCharging car={car} />
          {history?.configured && <BatteryChart history={history} plan={plan} now={now} />}
          {history?.configured && <WeekChart history={history} />}
          <AutoSettings car={status} refresh={car.refresh} />
        </>
      )}
    </section>
  );
}

function CarBattery({ car, plan, now }: { car: CarStatus; plan: ChargePlan | null; now: Date }) {
  const pct = car.batteryPct;
  const readAt = car.telemetryAt ?? car.batteryUpdatedAt;
  const updated = readAt ? Math.max(0, Math.round((now.getTime() - Date.parse(readAt)) / 60_000)) : null;
  // The marker shows where this charge is heading, or the sun limit when idle.
  const marker = plan ? plan.target : car.settings?.chargeLimit ?? null;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  return (
    <div className="car-battery">
      <div className="car-battery-top">
        <div className="car-battery-figures">
          <strong>{pct == null ? "–" : `${Math.round(pct)}%`}</strong>
          <span>{car.rangeKm != null ? `${Math.round(car.rangeKm)} km` : "No range yet"}</span>
        </div>
        {plan && <ChargeEta plan={plan} now={now} />}
      </div>
      <div className="car-battery-bar" role="img" aria-label={pct == null ? "Battery unknown" : `Battery ${Math.round(pct)}%`}>
        {plan && <span className="projected" style={{ width: `${clamp(plan.endPct)}%` }} />}
        {pct != null && <span className={`fill${plan ? " charging" : ""}`} style={{ width: `${clamp(pct)}%` }} />}
        {marker != null && <span className="limit" style={{ left: `${clamp(marker)}%` }} />}
      </div>
      <small>
        {plan && <>+{plan.rate.toFixed(1)}% an hour · </>}
        {pct == null
          ? "No reading from the BYD app yet"
          : updated == null || updated < 1 ? "BYD app just now" : `BYD app ${updated} min ago`}
      </small>
    </div>
  );
}

/** When the charge ends, and where the battery will be. */
function ChargeEta({ plan, now }: { plan: ChargePlan; now: Date }) {
  const left = plan.endAt.getTime() - now.getTime();
  const end = Math.floor(plan.endPct);
  let detail: string;
  if (left <= 0) detail = `At ${plan.target}% now`;
  else if (plan.cutShort && plan.needsSun) detail = `About ${end}% by sunset`;
  else if (plan.cutShort) detail = `Stops at about ${end}%`;
  else if (plan.needsSun) detail = `${plan.target}% if the sun holds`;
  else detail = `${plan.target}% in ${formatDuration(left)}`;
  return (
    <div className="car-eta">
      <strong>{left <= 0 ? "Any minute" : formatClock(plan.endAt, now)}</strong>
      <span>{detail}</span>
    </div>
  );
}

// Each line says what Auto does with the number, for someone who didn't set it up.
const SETTING_ROWS: Array<{ key: CarSettingKey; label: string; about: string }> = [
  {
    key: "chargeLimit",
    label: "Sun charging stops at",
    about: "When the roof makes more power than the house is using, Auto puts the spare into the car for free. It stops once the battery reaches this.",
  },
  {
    key: "dayMinimum",
    label: "By day, charge anyway below",
    about: "Between 6am and 9pm, if the battery drops under this, Auto charges even on a cloudy day, paying for grid power, until it's back up to this.",
  },
  {
    key: "overnightBelow",
    label: "Top up overnight when below",
    about: "If the battery is under this after 9pm, Auto charges from the grid overnight so the car isn't low in the morning.",
  },
  {
    key: "overnightTarget",
    label: "Overnight top-up to",
    about: "Where that overnight charge stops. It also stops at 7am. The charger adds about 2.4% an hour, so a night adds about 24%.",
  },
];

/** The numbers Auto works from, folded away so the page is just the car and its modes. */
function AutoSettings({ car, refresh }: { car: CarStatus; refresh: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`car-settings-toggle${open ? " is-open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Settings aria-hidden="true" />Auto settings<ChevronDown className="chevron" aria-hidden="true" />
      </button>
      {open && <CarSettings car={car} refresh={refresh} />}
    </>
  );
}
const SETTING_PENDING_LIMIT_MS = 10_000;

function CarSettings({ car, refresh }: { car: CarStatus; refresh: () => void | Promise<void> }) {
  const [pending, setPending] = useState<{ key: CarSettingKey; value: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState<CarSettingKey | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (pending && car.settings?.[pending.key] === pending.value) setPending(null);
  }, [pending, car.settings]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function change(key: CarSettingKey, value: number) {
    setError(null);
    setPending({ key, value });
    window.clearTimeout(timer.current);
    try {
      await readJsonResponse(await fetch("/api/car/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
        signal: AbortSignal.timeout(SETTING_PENDING_LIMIT_MS),
      }), "Home Assistant didn't answer");
      void refresh();
      timer.current = window.setTimeout(() => {
        setPending((current) => {
          if (current?.key === key && current.value === value) setError("Home Assistant didn't save that. Try again.");
          return current?.key === key && current.value === value ? null : current;
        });
      }, SETTING_PENDING_LIMIT_MS);
    } catch (requestError) {
      setError(requestError instanceof DOMException ? "Home Assistant didn't answer" : errorText(requestError, "Home Assistant didn't answer"));
      setPending(null);
    }
  }

  return (
    <div className="car-settings">
      {SETTING_ROWS.map(({ key, label, about: aboutText }) => {
        const saved = car.settings?.[key] ?? null;
        const value = pending?.key === key ? pending.value : saved;
        const { min, max } = CAR_SETTING_RANGES[key];
        const busy = pending != null || value == null;
        return (
          <div key={key} className="car-setting-block">
          <div className="car-setting">
            <span>
              {label}
              <button type="button" className={`car-setting-about${about === key ? " is-open" : ""}`} aria-label={`What "${label}" does`} aria-expanded={about === key} onClick={() => setAbout(about === key ? null : key)}><Info /></button>
            </span>
            <div className="car-stepper">
              <button aria-label={`${label}: less`} disabled={busy || value <= min} onClick={() => value != null && void change(key, value - CAR_SETTING_STEP)}><Minus /></button>
              <strong>{pending?.key === key ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{value == null ? "–" : `${value}%`}</strong>
              <button aria-label={`${label}: more`} disabled={busy || value >= max} onClick={() => value != null && void change(key, value + CAR_SETTING_STEP)}><Plus /></button>
            </div>
          </div>
          {about === key && <p className="car-chart-info">{aboutText}</p>}
          </div>
        );
      })}
      {error && <small className="error">{error}</small>}
    </div>
  );
}

/** The home screen's car readout, next to the solar numbers. Opens the Car page. */
export function CarHomeWidget({ onOpen }: { onOpen: () => void }) {
  const { state } = useCar(60_000);
  if (state.kind !== "ready" || !state.car.configured || state.car.batteryPct == null) return null;
  const charging = carHeadline(state.car).charging;
  return (
    <button
      type="button"
      className={`solar-home-widget car-home-widget${charging ? " charging" : ""}`}
      aria-label={`Car ${Math.round(state.car.batteryPct)}%${charging ? ", charging" : ""}. Open car details`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onOpen}
    >
      <span>{charging ? <BatteryCharging aria-hidden="true" /> : <Car aria-hidden="true" />}{Math.round(state.car.batteryPct)}%</span>
    </button>
  );
}

const CAR_MODE_ICONS: Record<CarMode, ReactNode> = { solar: <Sun />, boost: <Zap />, off: <Power /> };
// Home Assistant answers at once, but the mode only shows once the next poll reads it back.
const CAR_PENDING_LIMIT_MS = 10_000;

// The BYD charges from the garage plug. Home Assistant decides when; this picks the mode.
export function CarCharging({ car: shared }: { car?: ReturnType<typeof useCar> } = {}) {
  const own = useCar(5000, { enabled: !shared });
  const { state, refresh } = shared ?? own;
  const [pending, setPending] = useState<CarMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boostOpen, setBoostOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const car = state.kind === "ready" ? state.car : null;

  useEffect(() => {
    if (pending && car?.mode === pending) setPending(null);
  }, [pending, car?.mode]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (state.kind === "loading" || (car && !car.configured)) return null;
  if (state.kind === "error") return <div className="car-charging"><strong>{state.message}</strong></div>;
  if (!car) return null;

  async function choose(mode: CarMode, target?: number) {
    setBoostOpen(false);
    setError(null);
    setPending(mode);
    window.clearTimeout(timer.current);
    try {
      await readJsonResponse(await fetch("/api/car/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target == null ? { mode } : { mode, target }),
        signal: AbortSignal.timeout(CAR_PENDING_LIMIT_MS),
      }), "Home Assistant didn't answer");
      void refresh();
      timer.current = window.setTimeout(() => {
        setPending((current) => {
          if (current === mode) setError("Home Assistant didn't change the charging mode. Try again.");
          return current === mode ? null : current;
        });
      }, CAR_PENDING_LIMIT_MS);
    } catch (requestError) {
      setError(requestError instanceof DOMException ? "Home Assistant didn't answer" : errorText(requestError, "Home Assistant didn't answer"));
      setPending(null);
    }
  }

  const headline = carHeadline(car);
  const selected = pending ?? car.mode;
  const totals = [
    car.todayKwh != null ? `${formatKwh(car.todayKwh)} today` : null,
    car.monthKwh != null ? `${formatKwh(car.monthKwh)} this month` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={`car-charging${headline.charging ? " is-charging" : ""}`}>
      <span className="car-charging-icon"><Car aria-hidden="true" /></span>
      <div className="car-charging-text">
        <strong>{headline.title}</strong>
        {(error || headline.detail) && <span className={error ? "error" : undefined}>{error ?? headline.detail}</span>}
        {totals && <small>{totals}</small>}
      </div>
      <div className="car-charging-modes" role="radiogroup" aria-label="Car charging">
        {CAR_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            role="radio"
            aria-checked={selected === mode}
            className={selected === mode ? "is-selected" : undefined}
            disabled={pending != null}
            // Boost always asks how far, even while boosting, so the target can change.
            onClick={() => (mode === "boost" ? setBoostOpen(true) : selected !== mode && void choose(mode))}
          >
            {pending === mode ? <LoaderCircle className="spin" aria-hidden="true" /> : CAR_MODE_ICONS[mode]}
            {label}
          </button>
        ))}
      </div>
      {boostOpen && <BoostSheet car={car} onBoost={(target) => void choose("boost", target)} onCancel={() => setBoostOpen(false)} />}
    </div>
  );
}

const BOOST_CHOICES = [60, 70, 80, 90, 100];

/** Asks how far to boost. Starts at the last target, or the next 10% up from where the car is. */
function BoostSheet({ car, onBoost, onCancel }: { car: CarStatus; onBoost: (target: number) => void; onCancel: () => void }) {
  const battery = car.batteryPct ?? null;
  const floor = battery == null ? 10 : Math.min(100, Math.ceil((battery + 1) / CAR_SETTING_STEP) * CAR_SETTING_STEP);
  const [target, setTarget] = useState(() => Math.max(floor, car.boostTarget ?? 80));
  return (
    <div className="car-boost-backdrop" onPointerDown={onCancel}>
      <div className="car-boost-sheet" role="dialog" aria-label="Boost charge" onPointerDown={(event) => event.stopPropagation()}>
        <h2>Boost to</h2>
        <div className="car-stepper">
          <button aria-label="Less" disabled={target - CAR_SETTING_STEP < floor} onClick={() => setTarget(target - CAR_SETTING_STEP)}><Minus /></button>
          <strong>{target}%</strong>
          <button aria-label="More" disabled={target >= 100} onClick={() => setTarget(target + CAR_SETTING_STEP)}><Plus /></button>
        </div>
        <div className="car-boost-choices">
          {BOOST_CHOICES.map((value) => (
            <button key={value} className={value === target ? "is-selected" : undefined} disabled={value < floor} onClick={() => setTarget(value)}>{value}%</button>
          ))}
        </div>
        <p>{battery == null ? "Charges sun or not, then goes back to Auto." : `From ${Math.round(battery)}%, sun or not, then back to Auto.`}</p>
        <div className="car-boost-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onBoost(target)}><Zap aria-hidden="true" />Boost</button>
        </div>
      </div>
    </div>
  );
}

// Shared frame for the car graphs, drawn in viewBox units like the solar chart.
const CHART = { width: 1000, left: 64, right: 22, top: 22 };
const HOUR_MS = 60 * 60_000;
// How far past now the battery graph may reach to show the end of a charge.
const MAX_AHEAD_MS = 14 * HOUR_MS;

function hourLabel(at: Date) {
  const hour = at.getHours();
  return hour === 0 ? "12am" : hour === 12 ? "12pm" : hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * The battery across the last day, with the charge so far shaded by where its
 * power came from, and a dashed line to where the current charge should end.
 */
function BatteryChart({ history, plan, now }: { history: CarHistory; plan: ChargePlan | null; now: Date }) {
  const chart = useMemo(() => {
    if (!history.start || !history.stepMinutes) return null;
    const start = Date.parse(history.start);
    const nowMs = now.getTime();
    const ahead = plan ? Math.min(MAX_AHEAD_MS, Math.max(HOUR_MS, plan.endAt.getTime() - nowMs + HOUR_MS / 2)) : 0;
    const end = nowMs + ahead;
    const plotWidth = CHART.width - CHART.left - CHART.right;
    const batteryTop = CHART.top;
    const batteryHeight = 300;
    const laneTop = batteryTop + batteryHeight + 34;
    const laneHeight = 70;
    const height = laneTop + laneHeight + 44;
    const x = (ms: number) => CHART.left + ((ms - start) / (end - start)) * plotWidth;
    const y = (pct: number) => batteryTop + batteryHeight - (Math.min(100, Math.max(0, pct)) / 100) * batteryHeight;

    // The battery line, joining readings and breaking at gaps.
    const readings = (history.battery ?? []).filter(([ms]) => ms <= nowMs);
    let line = "";
    let area = "";
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length) {
        const path = run.map(([ms, pct], index) => `${index ? "L" : "M"} ${x(Math.max(ms, start)).toFixed(1)} ${y(pct).toFixed(1)}`).join(" ");
        line += `${path} `;
        if (run.length > 1) area += `${path} L ${x(run[run.length - 1][0]).toFixed(1)} ${y(0)} L ${x(Math.max(run[0][0], start)).toFixed(1)} ${y(0)} Z `;
      }
      run = [];
    };
    readings.forEach(([ms, pct]) => (pct == null ? flush() : run.push([ms, pct])));
    // Hold the last reading until now, unless the charge picks it up below.
    const last = run[run.length - 1];
    if (last && !plan) run.push([nowMs, last[1]]);
    flush();

    let projection = "";
    let endPoint: { x: number; y: number; label: string } | null = null;
    if (plan && last) {
      const endAt = Math.min(plan.endAt.getTime(), end);
      const endPct = plan.endAt.getTime() <= end ? plan.endPct : plan.nowPct + plan.rate * ((end - nowMs) / HOUR_MS);
      projection = `M ${x(last[0]).toFixed(1)} ${y(last[1]).toFixed(1)} L ${x(nowMs).toFixed(1)} ${y(plan.nowPct).toFixed(1)} L ${x(endAt).toFixed(1)} ${y(endPct).toFixed(1)}`;
      endPoint = { x: x(endAt), y: y(endPct), label: `${Math.floor(endPct)}% · ${formatClock(new Date(endAt), now)}` };
    }

    // The charging lane: sun stacked under grid, as kW, 0 to the charger's 2 kW.
    const step = history.stepMinutes * 60_000;
    const laneMax = 2;
    const barWidth = Math.max(1, (step / (end - start)) * plotWidth - 1);
    const bars = (history.sunKw ?? []).flatMap((sunKw, index) => {
      const gridKw = history.gridKw?.[index] ?? 0;
      const sun = sunKw ?? 0;
      if (sun + gridKw < 0.05) return [];
      const left = x(start + index * step);
      const scale = (kw: number) => (Math.min(kw, laneMax) / laneMax) * laneHeight;
      const sunHeight = scale(sun);
      const gridHeight = Math.min(laneHeight - sunHeight, scale(gridKw));
      return [{ key: index, left, sunHeight, gridHeight }];
    });

    // Gridlines at every 25%, hour labels every six hours on the clock.
    const ticks = [0, 25, 50, 75, 100].map((pct) => ({ pct, y: y(pct) }));
    const hours: Array<{ x: number; label: string }> = [];
    const first = new Date(start);
    first.setMinutes(0, 0, 0);
    for (let ms = first.getTime() + HOUR_MS; ms <= end; ms += HOUR_MS) {
      const at = new Date(ms);
      if (at.getHours() % 6 === 0 && x(ms) > CHART.left + 20 && x(ms) < CHART.width - CHART.right - 20) hours.push({ x: x(ms), label: hourLabel(at) });
    }
    return {
      height, line, area, projection, endPoint, bars, ticks, hours, laneTop, laneHeight,
      nowX: x(nowMs), futureWidth: x(end) - x(nowMs), plotBottom: y(0), barWidth,
      targetY: plan ? y(plan.target) : null,
      hasReadings: readings.some(([, pct]) => pct != null),
    };
  }, [history, plan, now]);

  if (!chart) return null;
  return (
    <div className="car-chart-card">
      <div className="car-chart-heading">
        <h2>Last 24 hours</h2>
        <div className="car-chart-legend">
          <span className="battery">Battery</span>
          <span className="sun">Sun</span>
          <span className="grid">Grid</span>
        </div>
      </div>
      <svg className="car-chart" viewBox={`0 0 ${CHART.width} ${chart.height}`} role="img" aria-label={`Battery over the last day${chart.endPoint ? `, heading for ${chart.endPoint.label}` : ""}`}>
        {chart.futureWidth > 0 && <rect className="car-chart-future" x={chart.nowX} y={CHART.top} width={chart.futureWidth} height={chart.plotBottom - CHART.top} />}
        {chart.ticks.map(({ pct, y }) => (
          <g key={pct} className="car-chart-grid">
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y} y2={y} />
            <text x={CHART.left - 12} y={y + 5} textAnchor="end">{pct}%</text>
          </g>
        ))}
        {chart.targetY != null && <line className="car-chart-target" x1={chart.nowX} x2={CHART.width - CHART.right} y1={chart.targetY} y2={chart.targetY} />}
        <path className="car-chart-area" d={chart.area} />
        <path className="car-chart-line" d={chart.line} />
        {chart.projection && <path className="car-chart-projection" d={chart.projection} />}
        {chart.endPoint && (
          <g className="car-chart-end">
            <circle cx={chart.endPoint.x} cy={chart.endPoint.y} r={8} />
            <text x={Math.min(chart.endPoint.x, CHART.width - CHART.right - 4)} y={chart.endPoint.y - 18} textAnchor={chart.endPoint.x > CHART.width - 200 ? "end" : "middle"}>{chart.endPoint.label}</text>
          </g>
        )}
        <line className="car-chart-now" x1={chart.nowX} x2={chart.nowX} y1={CHART.top} y2={chart.laneTop + chart.laneHeight} />
        <g className="car-chart-grid">
          <line x1={CHART.left} x2={CHART.width - CHART.right} y1={chart.laneTop} y2={chart.laneTop} />
          <text x={CHART.left - 12} y={chart.laneTop + 5} textAnchor="end">2 kW</text>
        </g>
        <line className="car-chart-lane-base" x1={CHART.left} x2={CHART.width - CHART.right} y1={chart.laneTop + chart.laneHeight} y2={chart.laneTop + chart.laneHeight} />
        {chart.bars.map(({ key, left, sunHeight, gridHeight }) => (
          <g key={key}>
            {sunHeight > 0 && <rect className="car-chart-sun" x={left} y={chart.laneTop + chart.laneHeight - sunHeight} width={chart.barWidth} height={sunHeight} />}
            {gridHeight > 0 && <rect className="car-chart-grid-power" x={left} y={chart.laneTop + chart.laneHeight - sunHeight - gridHeight} width={chart.barWidth} height={gridHeight} />}
          </g>
        ))}
        {chart.hours.map(({ x, label }) => (
          <text key={`${x}`} className="car-chart-hour" x={x} y={chart.height - 12} textAnchor="middle">{label}</text>
        ))}
        {!chart.hasReadings && <text className="car-chart-empty" x={CHART.width / 2} y={CHART.top + 150} textAnchor="middle">No battery readings yet</text>}
      </svg>
    </div>
  );
}

/** kWh into the car each day this week, sun under grid. */
function WeekChart({ history }: { history: CarHistory }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const days = history.days ?? [];
  if (!days.length) return null;
  const known = days.filter((day) => day.sunKwh != null);
  const sun = known.reduce((sum, day) => sum + (day.sunKwh ?? 0), 0);
  const total = known.reduce((sum, day) => sum + (day.sunKwh ?? 0) + (day.gridKwh ?? 0), 0);
  const max = Math.max(4, ...known.map((day) => (day.sunKwh ?? 0) + (day.gridKwh ?? 0)));
  const height = 230;
  const plotTop = 40;
  const plotBottom = height - 44;
  const slot = (CHART.width - CHART.left - CHART.right) / days.length;
  const barWidth = Math.min(84, slot * 0.62);
  const scale = (kwh: number) => (kwh / max) * (plotBottom - plotTop);

  return (
    <div className="car-chart-card">
      <div className="car-chart-heading">
        <h2>This week</h2>
        <div className="car-week-total">
          {total > 0 && <span><strong>{formatKwh(total)}</strong>{` · ${Math.round((100 * sun) / total)}% sun`}</span>}
          <button type="button" className={infoOpen ? "is-open" : undefined} aria-label="How sun and grid are split" aria-expanded={infoOpen} onClick={() => setInfoOpen(!infoOpen)}><Info /></button>
        </div>
      </div>
      {infoOpen && (
        <p className="car-chart-info">
          The house can't send sun back to the grid, so the meter can't say where the car's power came from. Any grid power the house was buying, up to what the car drew, counts as grid. The rest is sun.
        </p>
      )}
      <svg className="car-chart" viewBox={`0 0 ${CHART.width} ${height}`} role="img" aria-label={`Charged ${formatKwh(total)} this week`}>
        <line className="car-chart-lane-base" x1={CHART.left} x2={CHART.width - CHART.right} y1={plotBottom} y2={plotBottom} />
        {days.map((day, index) => {
          const center = CHART.left + slot * index + slot / 2;
          const date = new Date(`${day.date}T12:00:00`);
          const label = index === days.length - 1 ? "Today" : date.toLocaleDateString("en-AU", { weekday: "short" });
          const sunHeight = scale(day.sunKwh ?? 0);
          const gridHeight = scale(day.gridKwh ?? 0);
          const dayTotal = (day.sunKwh ?? 0) + (day.gridKwh ?? 0);
          return (
            <g key={day.date}>
              {day.sunKwh == null
                ? <rect className="car-chart-missing" x={center - barWidth / 2} y={plotBottom - 6} width={barWidth} height={6} rx={3} />
                : (
                  <>
                    {sunHeight > 0 && <rect className="car-chart-sun" x={center - barWidth / 2} y={plotBottom - sunHeight} width={barWidth} height={sunHeight} />}
                    {gridHeight > 0 && <rect className="car-chart-grid-power" x={center - barWidth / 2} y={plotBottom - sunHeight - gridHeight} width={barWidth} height={gridHeight} />}
                    {dayTotal >= 0.1 && <text className="car-chart-value" x={center} y={plotBottom - sunHeight - gridHeight - 10} textAnchor="middle">{dayTotal.toFixed(1)}</text>}
                  </>
                )}
              <text className="car-chart-hour" x={center} y={height - 12} textAnchor="middle">{label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
