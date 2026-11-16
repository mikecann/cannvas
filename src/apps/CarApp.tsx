import { BatteryCharging, Car, LoaderCircle, Minus, Plus, Power, Sun, Zap } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CAR_MODES, CAR_SETTING_RANGES, CAR_SETTING_STEP, type CarMode, type CarSettingKey, type CarStatus, carHeadline, useCar } from "../lib/car";
import { errorText, readJsonResponse } from "../lib/http";
import { formatKwh } from "../lib/solar";

// The car's own page: its battery, what the garage plug is doing, and the
// numbers Home Assistant's charging rules use (deploy/home-assistant/car_charging.yaml).
export function CarApp() {
  const car = useCar(5000);
  const status = car.state.kind === "ready" ? car.state.car : null;

  return (
    <section className="car-app">
      <h1>Car</h1>
      {car.state.kind === "loading" && <div className="car-message">Checking the car…</div>}
      {car.state.kind === "error" && <div className="car-message">{car.state.message}</div>}
      {status && !status.configured && <div className="car-message">Connect Home Assistant in Home controls to see the car.</div>}
      {status?.configured && (
        <>
          <CarBattery car={status} />
          <CarCharging car={car} />
          <CarSettings car={status} refresh={car.refresh} />
        </>
      )}
    </section>
  );
}

function CarBattery({ car }: { car: CarStatus }) {
  const pct = car.batteryPct;
  const updated = car.batteryUpdatedAt ? Math.max(0, Math.round((Date.now() - Date.parse(car.batteryUpdatedAt)) / 60_000)) : null;
  const limit = car.settings?.chargeLimit ?? null;
  return (
    <div className="car-battery">
      <div className="car-battery-figures">
        <strong>{pct == null ? "–" : `${Math.round(pct)}%`}</strong>
        <span>{car.rangeKm != null ? `${Math.round(car.rangeKm)} km` : "No range yet"}</span>
      </div>
      <div className="car-battery-bar" role="img" aria-label={pct == null ? "Battery unknown" : `Battery ${Math.round(pct)}%`}>
        {pct != null && <span className="fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />}
        {limit != null && <span className="limit" style={{ left: `${limit}%` }} />}
      </div>
      <small>
        {pct == null
          ? "No reading from the BYD app yet"
          : updated == null || updated < 1 ? "From the BYD app just now" : `From the BYD app ${updated} min ago`}
      </small>
    </div>
  );
}

const SETTING_ROWS: Array<{ key: CarSettingKey; label: string }> = [
  { key: "chargeLimit", label: "Sun charging stops at" },
  { key: "overnightBelow", label: "Top up overnight when below" },
  { key: "overnightTarget", label: "Overnight top-up to" },
];
const SETTING_PENDING_LIMIT_MS = 10_000;

function CarSettings({ car, refresh }: { car: CarStatus; refresh: () => void | Promise<void> }) {
  const [pending, setPending] = useState<{ key: CarSettingKey; value: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      {SETTING_ROWS.map(({ key, label }) => {
        const saved = car.settings?.[key] ?? null;
        const value = pending?.key === key ? pending.value : saved;
        const { min, max } = CAR_SETTING_RANGES[key];
        const busy = pending != null || value == null;
        return (
          <div key={key} className="car-setting">
            <span>{label}</span>
            <div className="car-stepper">
              <button aria-label={`${label}: less`} disabled={busy || value <= min} onClick={() => value != null && void change(key, value - CAR_SETTING_STEP)}><Minus /></button>
              <strong>{pending?.key === key ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{value == null ? "–" : `${value}%`}</strong>
              <button aria-label={`${label}: more`} disabled={busy || value >= max} onClick={() => value != null && void change(key, value + CAR_SETTING_STEP)}><Plus /></button>
            </div>
          </div>
        );
      })}
      <small className={error ? "error" : undefined}>{error ?? "Overnight top-ups run from 9pm to 7am on grid power, adding about 8% an hour."}</small>
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

const CAR_MODE_ICONS: Record<CarMode, ReactNode> = { solar: <Sun />, now: <Zap />, off: <Power /> };
// Home Assistant answers at once, but the mode only shows once the next poll reads it back.
const CAR_PENDING_LIMIT_MS = 10_000;

// The BYD charges from the garage plug. Home Assistant decides when; this picks the mode.
export function CarCharging({ car: shared }: { car?: ReturnType<typeof useCar> } = {}) {
  const own = useCar(5000, { enabled: !shared });
  const { state, refresh } = shared ?? own;
  const [pending, setPending] = useState<CarMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const car = state.kind === "ready" ? state.car : null;

  useEffect(() => {
    if (pending && car?.mode === pending) setPending(null);
  }, [pending, car?.mode]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (state.kind === "loading" || (car && !car.configured)) return null;
  if (state.kind === "error") return <div className="car-charging"><strong>{state.message}</strong></div>;
  if (!car) return null;

  async function choose(mode: CarMode) {
    setError(null);
    setPending(mode);
    window.clearTimeout(timer.current);
    try {
      await readJsonResponse(await fetch("/api/car/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
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
            onClick={() => selected !== mode && void choose(mode)}
          >
            {pending === mode ? <LoaderCircle className="spin" aria-hidden="true" /> : CAR_MODE_ICONS[mode]}
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
