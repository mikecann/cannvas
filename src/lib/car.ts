import { useRef, useState } from "react";
import { errorText, readJsonResponse } from "./http";
import { formatKw } from "./solar";
import { CHARGING_KW } from "./carPlan";
import { usePolling } from "./usePolling";

export type CarMode = "solar" | "boost" | "off";

/** What /api/car reports. Home Assistant runs the charging rules; see deploy/home-assistant/car_charging.yaml. */
export type CarStatus = {
  configured: boolean;
  mode?: CarMode | null;
  plugOn?: boolean | null;
  powerKw?: number | null;
  currentA?: number | null;
  todayKwh?: number | null;
  monthKwh?: number | null;
  spareKw?: number | null;
  reason?: string | null;
  retryAfter?: string | null;
  /** From the BYD app's cloud, polled every 10 minutes, so it lags a little. */
  batteryPct?: number | null;
  batteryUpdatedAt?: string | null;
  rangeKm?: number | null;
  pluggedIn?: boolean | null;
  overnightActive?: boolean;
  /** Charging up to the daytime minimum, sun or not. */
  minimumActive?: boolean;
  /** The % the last (or current) boost charges to. */
  boostTarget?: number | null;
  /** Power into the pack, from the car (kW, negative while driving). */
  batteryKw?: number | null;
  /** The car's own countdown to 100%, while it says it's charging. */
  fullInMinutes?: number | null;
  carCharging?: boolean | null;
  /** When the BYD cloud last answered. */
  telemetryAt?: string | null;
  settings?: Partial<Record<CarSettingKey, number | null>>;
};

export type CarSettingKey = "chargeLimit" | "dayMinimum" | "overnightBelow" | "overnightTarget";

/** Matches CAR_SETTINGS in deploy/cannvas-server and the input_numbers in car_charging.yaml. */
export const CAR_SETTING_RANGES: Record<CarSettingKey, { min: number; max: number }> = {
  chargeLimit: { min: 50, max: 100 },
  dayMinimum: { min: 0, max: 90 },
  overnightBelow: { min: 0, max: 90 },
  overnightTarget: { min: 10, max: 100 },
};
export const CAR_SETTING_STEP = 5;

export type CarState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; car: CarStatus };

export const CAR_MODES: Array<{ mode: CarMode; label: string }> = [
  { mode: "solar", label: "Auto" },
  { mode: "boost", label: "Boost" },
  { mode: "off", label: "Off" },
];

const STALE_AFTER_MS = 2 * 60 * 1000;

export function carHeadline(car: CarStatus): { title: string; detail: string | null; charging: boolean } {
  if (car.plugOn == null) return { title: "Can't reach the charger plug", detail: "Check it's plugged in and switched on at the wall.", charging: false };
  const charging = car.plugOn && (car.powerKw ?? 0) >= CHARGING_KW;
  if (charging) {
    return {
      title: car.mode === "boost" && car.boostTarget != null ? `Boosting to ${Math.round(car.boostTarget)}%` : `Charging at ${formatKw(car.powerKw)}`,
      detail: car.mode === "boost"
        ? `${formatKw(car.powerKw)}, sun or not. Back to Auto when it gets there.`
        : car.overnightActive || car.minimumActive
          ? car.reason ?? "Charging, sun or not."
          : "From sun that would otherwise go unused.",
      charging,
    };
  }
  if (car.plugOn) {
    return {
      title: "Ready, but the car isn't charging",
      detail: car.pluggedIn === false ? "The car isn't plugged in." : "It's full, or not plugged in.",
      charging,
    };
  }
  if (car.mode === "off") return { title: "Off", detail: car.reason && car.reason !== "Switched off" ? car.reason : null, charging };
  const retry = car.retryAfter ? new Date(car.retryAfter).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null;
  return {
    title: car.reason || "Waiting for spare sun",
    detail: retry ? `Trying again at ${retry}.` : "Starts by itself when there's about 2 kW of sun going unused.",
    charging,
  };
}

export function useCar(intervalMs: number, { enabled = true }: { enabled?: boolean } = {}) {
  const [state, setState] = useState<CarState>({ kind: "loading" });
  const lastSuccess = useRef(0);

  const refresh = usePolling(async (signal) => {
    try {
      const car = await readJsonResponse<CarStatus>(await fetch("/api/car", { signal }), "The car charger is unavailable");
      lastSuccess.current = Date.now();
      setState({ kind: "ready", car });
    } catch (error) {
      if (signal.aborted) return;
      const message = errorText(error, "The car charger is unavailable");
      setState((current) => current.kind === "ready" && Date.now() - lastSuccess.current < STALE_AFTER_MS
        ? current
        : { kind: "error", message });
    }
  }, intervalMs, { enabled });

  return { state, refresh };
}

/** What /api/car/history reports: the last day in 10-minute steps, and kWh per day this week. */
export type CarHistory = {
  configured: boolean;
  start?: string;
  end?: string;
  stepMinutes?: number;
  /** The car's draw each step, split by where it came from (kW). */
  sunKw?: Array<number | null>;
  gridKw?: Array<number | null>;
  /** Every BYD reading as [ms, %]. */
  battery?: Array<[number, number | null]>;
  /** Oldest first, today last. Null when the plug has no history that far back. */
  days?: Array<{ date: string; sunKwh: number | null; gridKwh: number | null }>;
};

export function useCarHistory(intervalMs = 5 * 60_000) {
  const [history, setHistory] = useState<CarHistory | null>(null);
  usePolling(async (signal) => {
    try {
      setHistory(await readJsonResponse<CarHistory>(await fetch("/api/car/history", { signal }), "No charging history"));
    } catch {
      // Keep the last graphs; they only change every few minutes anyway.
    }
  }, intervalMs);
  return history;
}
