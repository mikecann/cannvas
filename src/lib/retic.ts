export type ReticZone = {
  zone: number;
  entityId: string;
  name: string;
  /** null while Home Assistant can't reach the controller. */
  state: string | null;
  open: boolean;
};

export type ReticSchedule = {
  /** ISO time of the next scheduled watering, or null outside the season. */
  nextRun: string | null;
  /** ISO weekdays, Monday = 1. */
  days: number[];
  /** Local start time, like "06:00". */
  start: string | null;
  skipPastMm: number | null;
  skipForecastMm: number | null;
  running: boolean;
  lastResult: string | null;
  rainLast24h: number | null;
  rainNext12h: number | null;
};

export type ReticStatus = {
  configured: boolean;
  /** The master switch. Off closes every zone and skips the schedule. */
  enabled?: boolean | null;
  available?: boolean;
  schedule?: ReticSchedule;
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

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Wed and Sun at 6:00 am" from ISO weekdays and a "06:00" start. */
export function scheduleLabel(days: number[], start: string | null): string {
  const names = [...days].sort((left, right) => left - right).map((day) => DAY_NAMES[day]).filter(Boolean);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "No days";
  const [hours, minutes] = (start ?? "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return list;
  return `${list} at ${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
}

/** "Tomorrow, 6:00 am", "Today, 6:00 pm" or "Sun 4 Oct, 6:00 am" in Perth time. */
export function nextRunLabel(nextRun: string | null, now = Date.now()): string {
  const at = nextRun ? Date.parse(nextRun) : Number.NaN;
  if (!Number.isFinite(at)) return "Not scheduled";
  const zone = "Australia/Perth";
  const day = (time: number) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(time);
  const time = new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(at).replace(/\s/g, " ").toLowerCase();
  if (day(at) === day(now)) return `Today, ${time}`;
  if (day(at) === day(now + 24 * 60 * 60 * 1000)) return `Tomorrow, ${time}`;
  const date = new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(at).replace(",", "");
  return `${date}, ${time}`;
}

export function formatMm(value: number | null | undefined): string {
  return value == null ? "–" : `${value.toFixed(1)} mm`;
}

/**
 * Why the schedule would skip if it ran now, matching the checks in the Home
 * Assistant package, or null if it would water.
 */
export function skipReason(status: Pick<ReticStatus, "enabled" | "rainDetected" | "schedule">): string | null {
  const schedule = status.schedule;
  if (status.enabled === false) return "the retic is switched off";
  if (status.rainDetected) return "the rain sensor is wet";
  if (!schedule) return null;
  const { rainLast24h, rainNext12h, skipPastMm, skipForecastMm } = schedule;
  if (rainLast24h != null && skipPastMm != null && rainLast24h >= skipPastMm) return `${formatMm(rainLast24h)} of rain in the last 24 hours`;
  if (rainNext12h != null && skipForecastMm != null && rainNext12h >= skipForecastMm) return `${formatMm(rainNext12h)} of rain forecast in the next 12 hours`;
  return null;
}
