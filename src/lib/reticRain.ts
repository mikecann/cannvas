/**
 * Rain for the retic page: daily totals for the history graph, and the rain
 * around the next scheduled run so the page can say whether it will skip.
 * The Pi fetches it from Open-Meteo for the same place Home Assistant's rain
 * sensors use, so this predicts the 6 am decision; it firms up as the run nears.
 */

const ZONE = "Australia/Perth";

/** Open-Meteo's hourly series. Each value is the rain in the hour before its time. */
export type HourlyRain = { time: string[]; precipitation: (number | null)[] };

export type RainDay = {
  /** Local date, "2026-11-09". */
  date: string;
  mm: number;
  /** True for days still to come, where the total is a forecast. */
  forecast: boolean;
};

export type RunRain = {
  /** Rain in the 24 hours before the run, partly or wholly forecast. */
  before: number;
  /** Rain forecast in the 12 hours after it starts. */
  after: number;
};

const localDate = (time: number) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(time);
const localHour = (time: number) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(time)
    .reduce<Record<string, string>>((all, part) => ({ ...all, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00`;
};

const round = (value: number) => Math.round(value * 10) / 10;

/** Daily rain totals, oldest first. Today counts as forecast. */
export function dailyRain(hourly: HourlyRain, now = Date.now()): RainDay[] {
  const today = localDate(now);
  const totals = new Map<string, number>();
  hourly.time.forEach((time, index) => {
    // Grouped by the time's own date, the way Open-Meteo's daily totals are.
    const date = time.slice(0, 10);
    totals.set(date, (totals.get(date) ?? 0) + (hourly.precipitation[index] ?? 0));
  });
  return [...totals]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, mm]) => ({ date, mm: round(mm), forecast: date >= today }));
}

/**
 * The rain the Home Assistant schedule will weigh up for a run at `at`: the
 * 24 hourly values up to and including the start hour, and the 12 after it.
 * Null when the forecast doesn't reach far enough yet.
 */
export function rainAroundRun(hourly: HourlyRain, at: string | null): RunRain | null {
  const start = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(start)) return null;
  const index = hourly.time.indexOf(localHour(start));
  if (index < 23 || index + 12 >= hourly.time.length) return null;
  const sum = (from: number, to: number) => round(hourly.precipitation.slice(from, to).reduce<number>((total, value) => total + (value ?? 0), 0));
  return { before: sum(index - 23, index + 1), after: sum(index + 1, index + 13) };
}
