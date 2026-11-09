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
  /** The zones a scheduled run waters, in order. */
  zones?: { entityId: string; minutes: number | null }[];
};

/** One scheduled run from the Home Assistant log, oldest first. */
export type ReticRun = {
  at: string;
  /** "watering" while it runs, or forever if Home Assistant restarted mid-run. */
  result: "watering" | "watered" | "stopped" | "skipped";
  reason: string | null;
  minutes: number | null;
  rainBefore: number | null;
  rainAfter: number | null;
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
  history?: ReticRun[];
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

/** The dial has to sit on RUN for app or scheduled watering to happen. */
export function dialBlocksWatering(dial: string | null | undefined): boolean {
  return dial != null && dial.toLowerCase() !== "run";
}

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Tue and Fri at 6:00 am" from ISO weekdays and a "06:00" start. */
export function scheduleLabel(days: number[], start: string | null): string {
  const names = [...days].sort((left, right) => left - right).map((day) => DAY_NAMES[day]).filter(Boolean);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "No days";
  const [hours, minutes] = (start ?? "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return list;
  return `${list} at ${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
}

export function formatMm(value: number | null | undefined): string {
  return value == null ? "–" : `${value.toFixed(1)} mm`;
}

const ZONE = "Australia/Perth";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The local date, "2026-11-09", of a time in Perth. */
export function perthDate(time: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(time);
}

/** "6 am", "6:30 am". */
function clockLabel(time: number): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: ZONE, hour: "numeric", minute: "2-digit" })
    .format(time).replace(/\s/g, " ").replace(":00", "").toLowerCase();
}

/** "today", "tomorrow", "Wednesday" within the week, or "Tue 1 Sep" further out. */
function dayLabel(time: number, now: number): string {
  const day = perthDate(time);
  if (day === perthDate(now)) return "today";
  if (day === perthDate(now + DAY_MS)) return "tomorrow";
  if (time - now < 6 * DAY_MS) return new Intl.DateTimeFormat("en-AU", { timeZone: ZONE, weekday: "long" }).format(time);
  return new Intl.DateTimeFormat("en-AU", { timeZone: ZONE, weekday: "short", day: "numeric", month: "short" }).format(time).replace(",", "");
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Why the next scheduled run looks set to skip, from the rain Home Assistant
 * will weigh up then, or null if it should water. `runRain` is null when the
 * forecast doesn't reach that far yet.
 */
export function predictedSkip(
  status: Pick<ReticStatus, "rainDetected" | "schedule">,
  runRain: { before: number; after: number } | null,
): string | null {
  const pastLimit = status.schedule?.skipPastMm ?? 3;
  const forecastLimit = status.schedule?.skipForecastMm ?? 5;
  if (runRain && runRain.before >= pastLimit) return `${formatMm(runRain.before)} of rain by then`;
  if (runRain && runRain.after >= forecastLimit) return `${formatMm(runRain.after)} of rain forecast that morning`;
  // The sensor dries out, so it only decides if it's still wet at 6 am.
  if (status.rainDetected) return "the rain sensor is wet";
  return null;
}

export type ReticOutlook = {
  headline: string;
  detail: string;
  tone: "water" | "skip" | "watering" | "off" | "warn";
};

/** The page's one-line answer to "will it water, and when?". */
export function reticOutlook(
  status: ReticStatus,
  runRain: { before: number; after: number } | null,
  now = Date.now(),
): ReticOutlook {
  const schedule = status.schedule;
  if (status.enabled === false) return { headline: "Retic is off", detail: "Nothing will water, not even the schedule", tone: "off" };
  if (status.enabled !== true) return { headline: "Retic switch unknown", detail: "Home Assistant can't read the master switch", tone: "warn" };
  if (!status.available) return { headline: "Controller offline", detail: "Check it's plugged in and on Wi-Fi", tone: "warn" };

  const open = status.zones?.find((zone) => zone.open);
  if (open) {
    const minutes = zoneMinutesLeft(status, open, now);
    const order = schedule?.zones ?? [];
    const index = order.findIndex(({ entityId }) => entityId === open.entityId);
    if (schedule?.running && index >= 0) {
      const rest = order.slice(index + 1).reduce((total, zone) => total + (zone.minutes ?? 0), 0);
      const detail = `Zone ${index + 1} of ${order.length}, ${open.name.toLowerCase()}`;
      if (minutes == null) return { headline: "Watering now", detail, tone: "watering" };
      return { headline: `Watering now, done about ${clockLabel(now + (minutes + rest) * 60_000)}`, detail, tone: "watering" };
    }
    // The zone's own row shows the minutes left, so say what's next instead.
    const next = schedule?.nextRun ? Date.parse(schedule.nextRun) : Number.NaN;
    const detail = Number.isFinite(next) ? `Next on the schedule ${dayLabel(next, now)}, ${clockLabel(next)}` : "Started by hand";
    return { headline: `Watering ${open.name.toLowerCase()}`, detail, tone: "watering" };
  }

  if (dialBlocksWatering(status.dial)) {
    return { headline: "Won't water", detail: `The controller's dial is on ${status.dial}. Turn it to RUN.`, tone: "warn" };
  }

  const at = schedule?.nextRun ? Date.parse(schedule.nextRun) : Number.NaN;
  if (!Number.isFinite(at)) return { headline: "No watering scheduled", detail: "The schedule is off June to August", tone: "off" };
  const day = dayLabel(at, now);
  const skip = predictedSkip(status, runRain);
  if (skip) {
    // Skips are only predicted within the forecast, so the day is always a word.
    return { headline: `${capitalise(day)}'s watering will skip`, detail: capitalise(skip), tone: "skip" };
  }
  const due = runRain ? runRain.before + runRain.after : null;
  const detail = due == null ? "Too far ahead to forecast rain"
    : due < 0.5 ? "No rain due"
    : `${formatMm(due)} of rain due, not enough to skip`;
  return { headline: `Next watering ${day}, ${clockLabel(at)}`, detail, tone: "water" };
}

export type RunMark = "watered" | "stopped" | "skipped" | "next" | "next-skip" | "running";

/** One mark per local date for the history graph: what each scheduled run did, and the next one. */
export function runMarks(status: ReticStatus, willSkip: boolean): Map<string, RunMark> {
  const marks = new Map<string, RunMark>();
  for (const run of status.history ?? []) {
    const at = Date.parse(run.at);
    if (!Number.isFinite(at)) continue;
    // A run still marked watering after the schedule stopped was cut short by a restart.
    const result = run.result === "watering" ? (status.schedule?.running ? "running" : "stopped") : run.result;
    marks.set(perthDate(at), result);
  }
  const next = status.schedule?.nextRun ? Date.parse(status.schedule.nextRun) : Number.NaN;
  if (Number.isFinite(next) && status.enabled === true && !marks.has(perthDate(next))) {
    marks.set(perthDate(next), willSkip ? "next-skip" : "next");
  }
  return marks;
}
