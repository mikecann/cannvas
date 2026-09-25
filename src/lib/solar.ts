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
    /** Forecast.Solar's modelled output. Missing on older servers. */
    possible?: Array<number | null>;
  };
  /** Forecast.Solar estimates. Each value is null if its sensor is missing. */
  forecast?: {
    potentialKw: number | null;
    todayKwh: number | null;
    remainingKwh: number | null;
    tomorrowKwh: number | null;
    peakAt: string | null;
  };
};

/**
 * Sun the panels could have turned into power but didn't. The system is zero
 * export with no battery, so the inverter only makes what the house uses.
 * Returns null unless the forecast is clearly above actual output, since the
 * forecast is a model and small gaps are just noise.
 */
export function spareSolarKw(actualKw: number | null | undefined, potentialKw: number | null | undefined): number | null {
  if (actualKw == null || potentialKw == null) return null;
  // Compare in watts so a gap of exactly 300 W isn't lost to float rounding.
  const spareW = Math.round((potentialKw - Math.max(0, actualKw)) * 1000);
  const thresholdW = Math.round(Math.max(0.3, potentialKw * 0.15) * 1000);
  return spareW >= thresholdW ? Math.round(spareW / 10) / 100 : null;
}

export type SolarState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; solar: SolarStatus };

// Ride out a brief Home Assistant blip, but never show old numbers as live.
export const SOLAR_STALE_AFTER_MS = 2 * 60 * 1000;

// HTTP success isn't enough: Home Assistant can answer with readings from an
// integration that stopped polling the inverter.
export function isSolarFresh(solar: Pick<SolarStatus, "updatedAt">, now = Date.now()): boolean {
  const updated = solar.updatedAt ? Date.parse(solar.updatedAt) : Number.NaN;
  return Number.isFinite(updated) && now - updated < SOLAR_STALE_AFTER_MS;
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
