// The Ring doorbell at the front door. Kept free of React so the rules can be tested directly.
import type { HomeAssistantEntity } from "./homeAssistant";

/** Entity ids from Home Assistant's Ring integration. */
export const FRONT_DOOR = {
  camera: "camera.front_door_live_view",
  ding: "event.front_door_ding",
  battery: "sensor.front_door_battery",
} as const;

export const LOW_BATTERY_PERCENT = 20;
// A ring this old when Cannvas first hears of it is history, not someone at the door.
export const MAX_DING_AGE_SECONDS = 90;

/** From /api/doorbell/ding. `ageSeconds` is measured on Home Assistant's clock. */
export type DingReading = {
  configured: boolean;
  ding?: string | null;
  ageSeconds?: number | null;
};

export type FrontDoor = {
  available: boolean;
  lastRing: Date | null;
  battery: number | null;
};

// Matches isUnavailable in homeAssistant.ts. Only types are imported, so Node runs the tests directly.
const isUnavailable = ({ state }: Pick<HomeAssistantEntity, "state">) => ["unavailable", "unknown"].includes(state.toLowerCase());

/** An event entity's state is the time it last fired, or unknown before it ever has. */
export function eventTime(entity: Pick<HomeAssistantEntity, "state"> | undefined): Date | null {
  if (!entity || isUnavailable(entity)) return null;
  const time = Date.parse(entity.state);
  return Number.isFinite(time) ? new Date(time) : null;
}

export function frontDoorFrom(entities: HomeAssistantEntity[]): FrontDoor | null {
  const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
  const camera = byId.get(FRONT_DOOR.camera);
  const ding = byId.get(FRONT_DOOR.ding);
  if (!camera && !ding) return null;
  const battery = byId.get(FRONT_DOOR.battery);
  const percent = battery && !isUnavailable(battery) ? Number(battery.state) : Number.NaN;
  return {
    available: camera !== undefined && !isUnavailable(camera),
    lastRing: eventTime(ding),
    battery: Number.isFinite(percent) ? percent : null,
  };
}

export function isBatteryLow(battery: number | null) {
  return battery !== null && battery < LOW_BATTERY_PERCENT;
}

/**
 * Whether a new reading of the doorbell is someone ringing now.
 *
 * `seen` is the latest ring Cannvas knows about. It is undefined until the
 * first reading, which only records the ring as already seen, so a ring from
 * before Cannvas started never pops up. A ring must also be recent: Home
 * Assistant restoring an old ring after a restart is not a visitor.
 */
export function checkDing(
  seen: string | null | undefined,
  reading: DingReading,
  nowMs = Date.now(),
): { seen: string | null | undefined; ring: boolean } {
  if (!reading.configured) return { seen, ring: false };
  const ding = reading.ding ?? null;
  if (seen === undefined) return { seen: ding, ring: false };
  // An unavailable doorbell keeps the last ring seen, so its return isn't news.
  if (ding === null || ding === seen) return { seen, ring: false };
  const time = Date.parse(ding);
  if (!Number.isFinite(time)) return { seen, ring: false };
  if (seen !== null && time <= Date.parse(seen)) return { seen, ring: false };
  const age = reading.ageSeconds ?? (nowMs - time) / 1000;
  // A little negative is fine: the two clocks can disagree by a moment.
  return { seen: ding, ring: age > -60 && age <= MAX_DING_AGE_SECONDS };
}
