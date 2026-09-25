// Gentle evening dimming for the wall screen. There is no light sensor, so
// the sun stands in for the room: start dimming at sunset, reach the deepest
// level at 21:00 (the Pi powers off at 21:15) and stay there until sunrise.
// A light sensor or camera could replace this later: only nightDimLevel and
// useNightDim decide the level, and the overlay just shows what they return.

/** Opacity of the black overlay at its darkest, so about 45% brightness. */
export const DEEPEST_DIM = 0.55;
export const DEEPEST_DIM_HOUR = 21;
/** How long a touch brings the full brightness back. */
export const TOUCH_WAKE_MS = 3 * 60_000;

// Busselton, Western Australia.
export const HOME_LOCATION = { latitude: -33.6516, longitude: 115.347 };

export type SunTimes = { sunrise: Date; sunset: Date };

const DAY_MS = 86_400_000;
const RAD = Math.PI / 180;

/**
 * Approximate sunrise and sunset for the local calendar day containing `day`,
 * accurate to a couple of minutes. Used when Home Assistant can't be reached.
 * This is the standard NOAA style solar equation, as used by SunCalc.
 */
export function calculateSunTimes(day: Date, latitude = HOME_LOCATION.latitude, longitude = HOME_LOCATION.longitude): SunTimes {
  const noon = new Date(day);
  noon.setHours(12, 0, 0, 0);
  const J1970 = 2440588;
  const J2000 = 2451545;
  const J0 = 0.0009;
  const obliquity = RAD * 23.4397;
  const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
  const fromJulian = (julian: number) => new Date((julian + 0.5 - J1970) * DAY_MS);
  const lw = RAD * -longitude;
  const phi = RAD * latitude;
  const cycle = Math.round(toDays(noon) - J0 - lw / (2 * Math.PI));
  const approxTransit = (hourAngle: number) => J0 + (hourAngle + lw) / (2 * Math.PI) + cycle;
  const meanAnomaly = RAD * (357.5291 + 0.98560028 * approxTransit(0));
  const center = RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
  const eclipticLongitude = meanAnomaly + center + RAD * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const transit = (ds: number) => J2000 + ds + 0.0053 * Math.sin(meanAnomaly) - 0.0069 * Math.sin(2 * eclipticLongitude);
  const solarNoon = transit(approxTransit(0));
  const horizon = RAD * -0.833;
  const hourAngle = Math.acos((Math.sin(horizon) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination)));
  const sunset = transit(approxTransit(hourAngle));
  return { sunrise: fromJulian(solarNoon - (sunset - solarNoon)), sunset: fromJulian(sunset) };
}

function sameLocalDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

/**
 * Today's sunrise and sunset from Home Assistant's sun.sun `next_rising` and
 * `next_setting`. Once today's has passed, Home Assistant reports tomorrow's,
 * which is within a couple of minutes of today's a day earlier.
 */
export function sunTimesFromNext(now: Date, nextRising: Date, nextSetting: Date): SunTimes {
  const today = (next: Date) => sameLocalDay(next, now) ? next : new Date(next.getTime() - DAY_MS);
  return { sunrise: today(nextRising), sunset: today(nextSetting) };
}

/** Overlay opacity for `now`: 0 in daylight, rising to DEEPEST_DIM at 21:00. */
export function nightDimLevel(now: Date, { sunrise, sunset }: SunTimes): number {
  if (now < sunrise) return DEEPEST_DIM;
  if (now < sunset) return 0;
  const deepest = new Date(now);
  deepest.setHours(DEEPEST_DIM_HOUR, 0, 0, 0);
  // Sunset is never this late in Busselton, but keep the ramp sensible.
  if (deepest.getTime() <= sunset.getTime()) return DEEPEST_DIM;
  if (now >= deepest) return DEEPEST_DIM;
  const progress = (now.getTime() - sunset.getTime()) / (deepest.getTime() - sunset.getTime());
  return Math.round(DEEPEST_DIM * progress * 1000) / 1000;
}
