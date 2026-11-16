// When a charge will end, worked out from the car's state. Kept free of React
// and fetch so the tests can load it straight into Node.
import type { CarStatus } from "./car";

// The car's charger idles at a watt or two, so anything under this isn't charging.
export const CHARGING_KW = 0.05;

// Mike's Atto 3 is the Extended Range: about 470 km at 100%.
export const BATTERY_KWH = 60.48;
// Wall to pack: 1.78 kW at the plug put 1.45 kW into the battery (16 Nov 2026).
const CHARGER_EFFICIENCY = 0.82;

/** How fast the battery is filling, in % an hour. The car's own figures first, then the plug's. */
export function chargeRate(car: CarStatus): number | null {
  if (car.carCharging && car.batteryKw != null && car.batteryKw > 0.2) return (car.batteryKw / BATTERY_KWH) * 100;
  const pct = car.batteryPct;
  if (car.fullInMinutes && pct != null && pct < 100) return (100 - pct) / (car.fullInMinutes / 60);
  if (car.powerKw != null && car.powerKw >= CHARGING_KW) return ((car.powerKw * CHARGER_EFFICIENCY) / BATTERY_KWH) * 100;
  return null;
}

export type ChargePlan = {
  /** Where this charge is heading. */
  target: number;
  /** The % it's expected to be at when it stops. */
  endPct: number;
  endAt: Date;
  /** A rule stops it before it reaches the target (9pm, 7am or sunset). */
  cutShort: boolean;
  /** Sun charging: only true if the sun holds. */
  needsSun: boolean;
  rate: number;
  /** Where the battery probably is now, between the BYD's 10-minute readings. */
  nowPct: number;
};

const HOUR_MS = 60 * 60_000;

/** The next time the clock reads `hour`:00 (local time), after `now`. */
function nextHour(now: Date, hour: number) {
  const at = new Date(now);
  at.setHours(hour, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/**
 * When the current charge should end, following the rules in
 * deploy/home-assistant/car_charging.yaml: a boost runs to its target, an
 * overnight top-up to its target or 7am, the daytime minimum to the minimum or
 * 9pm, and sun charging to the limit or sunset.
 */
export function chargePlan(car: CarStatus, now: Date, sunset: Date | null): ChargePlan | null {
  if (!car.plugOn || (car.powerKw ?? 0) < CHARGING_KW || car.batteryPct == null) return null;
  const rate = chargeRate(car);
  if (!rate) return null;
  // The BYD reports whole percents, so the reading ticked over to this value
  // at its last change. Move it on by the time since, short of the next tick.
  const changed = car.batteryUpdatedAt ? Date.parse(car.batteryUpdatedAt) : NaN;
  const sinceHours = Number.isNaN(changed) ? 0 : Math.max(0, now.getTime() - changed) / HOUR_MS;
  const nowPct = Math.min(car.batteryPct + rate * sinceHours, car.batteryPct + 0.99);

  const settings = car.settings ?? {};
  let target: number;
  let deadline: Date | null = null;
  let needsSun = false;
  if (car.mode === "boost") {
    target = car.boostTarget ?? 100;
  } else if (car.overnightActive) {
    target = settings.overnightTarget ?? 100;
    deadline = nextHour(now, 7);
  } else if (car.minimumActive) {
    target = settings.dayMinimum ?? 100;
    deadline = nextHour(now, 21);
  } else {
    target = settings.chargeLimit ?? 100;
    needsSun = true;
    // After sunset the sun rules switch the plug off within a few minutes.
    if (!sunset || sunset.getTime() <= now.getTime()) return null;
    deadline = sunset;
  }
  target = Math.min(100, target);
  if (nowPct >= target) return { target, endPct: target, endAt: now, cutShort: false, needsSun, rate, nowPct };
  const reachAt = new Date(now.getTime() + ((target - nowPct) / rate) * HOUR_MS);
  if (deadline && deadline < reachAt) {
    const endPct = nowPct + rate * ((deadline.getTime() - now.getTime()) / HOUR_MS);
    return { target, endPct, endAt: deadline, cutShort: true, needsSun, rate, nowPct };
  }
  return { target, endPct: target, endAt: reachAt, cutShort: false, needsSun, rate, nowPct };
}

export function formatClock(at: Date, now: Date) {
  const time = at.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  // "3:10am" is clearly tonight. Past about half a day, say which day.
  if (at.getTime() - now.getTime() < 12 * HOUR_MS) return time;
  return `${at.toLocaleDateString("en-AU", { weekday: "short" })} ${time}`;
}

export function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
