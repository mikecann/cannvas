import { useRef, useState } from "react";
import { errorText, readJsonResponse } from "./http";
import { formatKw } from "./solar";
import { usePolling } from "./usePolling";

export type CarMode = "solar" | "now" | "off";

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
};

export type CarState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; car: CarStatus };

export const CAR_MODES: Array<{ mode: CarMode; label: string }> = [
  { mode: "solar", label: "Sun only" },
  { mode: "now", label: "Charge now" },
  { mode: "off", label: "Off" },
];

// The car's charger idles at a watt or two, so anything under this isn't charging.
const CHARGING_KW = 0.05;
const STALE_AFTER_MS = 2 * 60 * 1000;

export function carHeadline(car: CarStatus): { title: string; detail: string | null; charging: boolean } {
  if (car.plugOn == null) return { title: "Can't reach the charger plug", detail: "Check it's plugged in and switched on at the wall.", charging: false };
  const charging = car.plugOn && (car.powerKw ?? 0) >= CHARGING_KW;
  if (charging) {
    return {
      title: `Charging at ${formatKw(car.powerKw)}`,
      detail: car.mode === "now" ? "Charging now, sun or not. Goes back to sun only when the car's full." : "From sun that would otherwise go unused.",
      charging,
    };
  }
  if (car.plugOn) return { title: "Ready, but the car isn't charging", detail: "It's full, or not plugged in.", charging };
  if (car.mode === "off") return { title: "Off", detail: car.reason && car.reason !== "Switched off" ? car.reason : null, charging };
  const retry = car.retryAfter ? new Date(car.retryAfter).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }) : null;
  return {
    title: car.reason || "Waiting for spare sun",
    detail: retry ? `Trying again at ${retry}.` : "Starts by itself when there's about 2 kW of sun going unused.",
    charging,
  };
}

export function useCar(intervalMs: number) {
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
  }, intervalMs);

  return { state, refresh };
}
