import { useEffect, useState } from "react";

export type SolarStatus = {
  configured: boolean;
  connected?: boolean;
  updatedAt?: string | null;
  status?: string | null;
  now?: {
    solarKw: number | null;
    houseKw: number | null;
    // Positive when buying from the grid, negative when exporting.
    gridKw: number | null;
    pvKw: number | null;
    temperatureC: number | null;
  };
  today?: {
    generatedKwh: number | null;
    consumedKwh: number | null;
    importedKwh: number | null;
    exportedKwh: number | null;
    selfPoweredPct: number | null;
    peakSolarKw: number | null;
    peakSolarAt: string | null;
  };
  series?: {
    start: string;
    stepMinutes: number;
    solar: Array<number | null>;
    house: Array<number | null>;
    grid: Array<number | null>;
  };
};

export type SolarState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; solar: SolarStatus };

// Ride out a brief Home Assistant blip, but never show old numbers as live.
const STALE_AFTER_MS = 2 * 60 * 1000;
// Without Home Assistant there is nothing to show, so only check back occasionally.
const UNCONFIGURED_INTERVAL_MS = 5 * 60 * 1000;

export function useSolar(intervalMs: number): SolarState {
  const [state, setState] = useState<SolarState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let lastSuccess = 0;
    const load = async () => {
      let nextDelay = intervalMs;
      try {
        const response = await fetch("/api/solar");
        const body = (await response.json()) as SolarStatus & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Solar data is unavailable");
        lastSuccess = Date.now();
        if (!body.configured) nextDelay = UNCONFIGURED_INTERVAL_MS;
        if (!cancelled) setState({ kind: "ready", solar: body });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Solar data is unavailable";
        if (!cancelled) setState((current) => current.kind === "ready" && Date.now() - lastSuccess < STALE_AFTER_MS ? current : { kind: "error", message });
      } finally {
        if (!cancelled) timer = window.setTimeout(load, nextDelay);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [intervalMs]);

  return state;
}

// HTTP success isn't enough: Home Assistant can answer with readings from an
// integration that stopped polling the inverter.
export function isSolarFresh(solar: Pick<SolarStatus, "updatedAt">, now = Date.now()): boolean {
  const updated = solar.updatedAt ? Date.parse(solar.updatedAt) : Number.NaN;
  return Number.isFinite(updated) && now - updated < STALE_AFTER_MS;
}

export function formatKw(value: number | null | undefined): string {
  if (value == null) return "–";
  const abs = Math.abs(value);
  return abs < 1 ? `${Math.round(abs * 1000)} W` : `${abs.toFixed(abs < 10 ? 2 : 1)} kW`;
}

export function formatKwh(value: number | null | undefined): string {
  if (value == null) return "–";
  return `${value.toFixed(value < 10 ? 1 : 0)} kWh`;
}

// Treat tiny readings as zero so the flow picture doesn't flicker on meter noise.
export const FLOW_THRESHOLD_KW = 0.03;
