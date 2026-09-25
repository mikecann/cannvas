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
