import { Home, PlugZap, Sun, UtilityPole } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { FLOW_THRESHOLD_KW, formatKw, formatKwh, isSolarFresh, type SolarStatus, spareSolarKw } from "../lib/solar";
import { useSolar } from "../lib/useSolar";

export function SolarApp() {
  const state = useSolar(5000);

  return (
    <section className="solar-app">
      <header className="solar-header">
        <div>
          <p className="eyebrow">Solar</p>
          <h1>Right now</h1>
        </div>
        {state.kind === "ready" && state.solar.configured && <SolarStatusPill solar={state.solar} />}
      </header>

      {state.kind === "loading" && <div className="solar-message">Reading the inverter…</div>}
      {state.kind === "error" && <div className="solar-message">{state.message}</div>}
      {state.kind === "ready" && !state.solar.configured && (
        <div className="solar-message">Connect Home Assistant in Home controls to see solar.</div>
      )}
      {state.kind === "ready" && state.solar.configured && (
        <>
          <PowerFlow solar={state.solar} />
          <SolarPotential solar={state.solar} />
          <TodayTiles solar={state.solar} />
          <DayChart solar={state.solar} />
        </>
      )}
    </section>
  );
}

function SolarStatusPill({ solar }: { solar: SolarStatus }) {
  const updated = solar.updatedAt ? new Date(solar.updatedAt) : null;
  const seconds = updated ? Math.max(0, Math.round((Date.now() - updated.getTime()) / 1000)) : null;
  const stale = !isSolarFresh(solar);
  return (
    <div className={`solar-status-pill${stale ? " stale" : ""}`}>
      <PlugZap aria-hidden="true" />
      <span>
        <strong>{solar.status ?? "Unknown"}</strong>
        {seconds == null ? "No reading yet" : seconds < 60 ? "Live" : `Updated ${Math.round(seconds / 60)} min ago`}
      </span>
    </div>
  );
}

function PowerFlow({ solar }: { solar: SolarStatus }) {
  // Keep missing readings as null so they show "–" rather than a false 0 W.
  const solarKw = solar.now?.solarKw ?? null;
  const houseKw = solar.now?.houseKw ?? null;
  const gridKw = solar.now?.gridKw ?? null;
  const importing = gridKw != null && gridKw > FLOW_THRESHOLD_KW;
  const exporting = gridKw != null && gridKw < -FLOW_THRESHOLD_KW;
  const producing = solarKw != null && solarKw > FLOW_THRESHOLD_KW;
  const potentialKw = solar.forecast?.potentialKw ?? null;

  return (
    <div className="solar-flow-card">
      <svg className="solar-flow" viewBox="0 0 1000 520" role="img" aria-label={`Solar ${formatKw(solarKw)}, home using ${formatKw(houseKw)}, grid ${importing ? "supplying" : exporting ? "receiving" : "idle"} ${formatKw(gridKw)}`}>
        <FlowLine d="M 210 238 C 210 350, 320 400, 430 400" active={producing} kw={solarKw ?? 0} tone="solar" />
        <FlowLine d="M 790 238 C 790 350, 680 400, 570 400" active={importing} kw={gridKw ?? 0} tone="grid" />
        <FlowLine d="M 290 110 L 710 110" active={exporting} kw={gridKw ?? 0} tone="export" />
      </svg>
      <FlowNode
        className="solar"
        x={21}
        y={21}
        icon={<Sun />}
        label="Solar"
        value={formatKw(solarKw)}
        note={potentialKw != null ? `Could make ~${formatKw(potentialKw)}` : undefined}
      />
      <FlowNode className="grid" x={79} y={21} icon={<UtilityPole />} label={exporting ? "Selling" : "Grid"} value={formatKw(gridKw)} />
      <FlowNode className="home" x={50} y={77} icon={<Home />} label="Home" value={formatKw(houseKw)} />
    </div>
  );
}

function FlowLine({ d, active, kw, tone }: { d: string; active: boolean; kw: number; tone: string }) {
  // Faster dots for bigger flows, clamped so tiny flows still move visibly.
  const duration = Math.max(0.5, Math.min(4, 2.4 / Math.max(0.2, Math.abs(kw))));
  return (
    <g className={`solar-flow-line ${tone}${active ? " active" : ""}`}>
      <path d={d} className="track" />
      {active && <path d={d} className="dots" style={{ animationDuration: `${duration}s` }} />}
    </g>
  );
}

function FlowNode({ className, x, y, icon, label, value, note }: { className: string; x: number; y: number; icon: ReactNode; label: string; value: string; note?: string }) {
  return (
    <div className={`solar-flow-node ${className}`} style={{ left: `${x}%`, top: `${y}%` }}>
      <span className="solar-flow-icon">{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
      {note && <em className="solar-flow-note">{note}</em>}
    </div>
  );
}

// Forecast.Solar is a weather model, so everything here is worded as an estimate.
function SolarPotential({ solar }: { solar: SolarStatus }) {
  const forecast = solar.forecast;
  if (!forecast || (forecast.potentialKw == null && forecast.todayKwh == null && forecast.tomorrowKwh == null)) return null;
  const actualKw = solar.now?.solarKw ?? null;
  const spare = spareSolarKw(actualKw, forecast.potentialKw);
  // Only claim the panels are keeping up when there's an actual reading to compare.
  const comparable = actualKw != null && forecast.potentialKw != null;
  const outlook = [
    forecast.todayKwh != null ? `about ${formatKwh(forecast.todayKwh)} today` : null,
    forecast.tomorrowKwh != null ? `${formatKwh(forecast.tomorrowKwh)} tomorrow` : null,
  ].filter(Boolean).join(", ");
  return (
    <div className={`solar-potential${spare != null ? " has-spare" : ""}`}>
      <strong>
        {spare != null
          ? `About ${formatKw(spare)} of sun going unused`
          : comparable
            ? "Using about all the sun there is right now"
            : "Solar forecast"}
      </strong>
      <span>
        {spare != null
          ? "With no battery and no export, the panels only make what the house is using. "
          : ""}
        {outlook ? `The forecast says the panels could make ${outlook}.` : ""}
      </span>
    </div>
  );
}

function TodayTiles({ solar }: { solar: SolarStatus }) {
  const today = solar.today;
  const peakAt = today?.peakSolarAt ? new Date(today.peakSolarAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <div className="solar-today">
      <article className="generated">
        <span>Made today</span>
        <strong>{formatKwh(today?.generatedKwh)}</strong>
        <small>{today?.peakSolarKw != null ? `Peak ${formatKw(today.peakSolarKw)}${peakAt ? ` at ${peakAt}` : ""}` : "No peak yet"}</small>
      </article>
      <article className="used">
        <span>Used today</span>
        <strong>{formatKwh(today?.consumedKwh)}</strong>
        <small>{today?.selfPoweredPct != null ? `${today.selfPoweredPct}% from solar` : "Waiting for data"}</small>
      </article>
      <article className="imported">
        <span>Bought</span>
        <strong>{formatKwh(today?.importedKwh)}</strong>
        <small>From the grid</small>
      </article>
      <article className="exported">
        <span>Sold</span>
        <strong>{formatKwh(today?.exportedKwh)}</strong>
        <small>To the grid</small>
      </article>
    </div>
  );
}

const CHART = { width: 1000, height: 700, left: 58, right: 18, top: 18, bottom: 44 };

function DayChart({ solar }: { solar: SolarStatus }) {
  const series = solar.series;
  const chart = useMemo(() => {
    if (!series) return null;
    const start = new Date(series.start).getTime();
    const step = series.stepMinutes * 60_000;
    const day = 24 * 60 * 60_000;
    const possible = series.possible ?? [];
    const values = [...series.solar, ...series.house, ...series.grid, ...possible].filter((value): value is number => value != null);
    const max = Math.max(2, Math.ceil(Math.max(...values, 0)));
    const plotWidth = CHART.width - CHART.left - CHART.right;
    const plotHeight = CHART.height - CHART.top - CHART.bottom;
    const x = (index: number) => CHART.left + ((index * step + step / 2) / day) * plotWidth;
    const y = (value: number) => CHART.top + plotHeight - (Math.max(0, value) / max) * plotHeight;
    const baseline = y(0);

    const line = (points: Array<number | null>) => {
      let path = "";
      let drawing = false;
      points.forEach((value, index) => {
        if (value == null) { drawing = false; return; }
        path += `${drawing ? "L" : "M"} ${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
        drawing = true;
      });
      return path;
    };
    const area = (points: Array<number | null>) => {
      // Close each unbroken run of readings down to the baseline.
      let path = "";
      let run: number[] = [];
      const flush = () => {
        if (run.length > 1) {
          path += `M ${x(run[0]).toFixed(1)} ${baseline} ` + run.map((index) => `L ${x(index).toFixed(1)} ${y(points[index] ?? 0).toFixed(1)}`).join(" ") + ` L ${x(run[run.length - 1]).toFixed(1)} ${baseline} Z `;
        }
        run = [];
      };
      points.forEach((value, index) => (value == null ? flush() : run.push(index)));
      flush();
      return path;
    };

    const nowX = CHART.left + (Math.min(day, Date.now() - start) / day) * plotWidth;
    const hours = [0, 3, 6, 9, 12, 15, 18, 21, 24];
    const ticks = Array.from({ length: max + 1 }, (_, value) => value).filter((value) => max <= 4 || value % 2 === 0);
    return {
      solarArea: area(series.solar),
      solarLine: line(series.solar),
      importArea: area(series.grid.map((value) => (value == null ? null : Math.max(0, value)))),
      houseLine: line(series.house),
      possibleLine: possible.some((value) => value != null) ? line(possible) : "",
      nowX,
      hours: hours.map((hour) => ({ hour, x: CHART.left + (hour / 24) * plotWidth })),
      ticks: ticks.map((value) => ({ value, y: y(value) })),
    };
  }, [series]);

  if (!chart) return null;

  return (
    <div className="solar-chart-card">
      <div className="solar-chart-heading">
        <h2>Today</h2>
        <div className="solar-chart-legend">
          <span className="solar">Solar</span>
          <span className="house">Home</span>
          <span className="grid">Grid</span>
          {chart.possibleLine && <span className="possible">Possible (estimate)</span>}
        </div>
      </div>
      <svg className="solar-chart" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label="Solar, home and grid power across today">
        {chart.ticks.map(({ value, y }) => (
          <g key={value} className="solar-chart-grid">
            <line x1={CHART.left} x2={CHART.width - CHART.right} y1={y} y2={y} />
            <text x={CHART.left - 12} y={y + 5} textAnchor="end">{value} kW</text>
          </g>
        ))}
        {chart.hours.map(({ hour, x }) => (
          <text key={hour} className="solar-chart-hour" x={x} y={CHART.height - 12} textAnchor="middle">
            {hour === 0 || hour === 24 ? "12am" : hour === 12 ? "12pm" : hour < 12 ? `${hour}am` : `${hour - 12}pm`}
          </text>
        ))}
        <path className="solar-chart-area" d={chart.solarArea} />
        <path className="solar-chart-import" d={chart.importArea} />
        <path className="solar-chart-solar-line" d={chart.solarLine} />
        {chart.possibleLine && <path className="solar-chart-possible" d={chart.possibleLine} />}
        <path className="solar-chart-house" d={chart.houseLine} />
        <line className="solar-chart-now" x1={chart.nowX} x2={chart.nowX} y1={CHART.top} y2={CHART.height - CHART.bottom} />
      </svg>
    </div>
  );
}
