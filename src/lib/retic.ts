export type ReticZone = {
  zone: number;
  entityId: string;
  name: string;
  /** null while Home Assistant can't reach the controller. */
  state: string | null;
  open: boolean;
};

export type ReticStatus = {
  configured: boolean;
  available?: boolean;
  zones?: ReticZone[];
  /** A timed run started from Cannvas, while Home Assistant is timing it. */
  run?: { entityId: string; endsAt: string } | null;
  runMinutes?: number[];
  /** The WX8's own countdown for a zone started on the controller or in Smart Life. */
  controllerMinutesLeft?: number | null;
  dial?: string | null;
  rainDetected?: boolean | null;
  batteryLow?: boolean | null;
  batteryVolts?: number | null;
  mainsProblem?: boolean | null;
};

export type ReticState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; retic: ReticStatus };

export const RETIC_STALE_AFTER_MS = 60 * 1000;

/** Whole minutes left for an open zone, rounded up, or null when unknown. */
export function zoneMinutesLeft(status: ReticStatus, zone: ReticZone, now = Date.now()): number | null {
  if (!zone.open) return null;
  if (status.run?.entityId === zone.entityId) {
    const ends = Date.parse(status.run.endsAt);
    if (Number.isFinite(ends)) return Math.max(0, Math.ceil((ends - now) / 60_000));
  }
  return status.controllerMinutesLeft ?? null;
}

export function minutesLeftLabel(minutes: number | null): string {
  if (minutes == null) return "Watering now";
  if (minutes <= 1) return "Less than a minute left";
  return `${minutes} min left`;
}

export function batteryLabel(status: Pick<ReticStatus, "batteryLow" | "batteryVolts">): string {
  if (status.batteryLow == null && status.batteryVolts == null) return "Unknown";
  if (status.batteryLow) return "Replace soon";
  return "OK";
}

/** The dial has to sit on RUN for app or scheduled watering to happen. */
export function dialBlocksWatering(dial: string | null | undefined): boolean {
  return dial != null && dial.toLowerCase() !== "run";
}
