// The Roborock vacuum, read from the states the Home controls already fetch.
// Kept free of React so the rules can be tested directly.
import type { HomeAssistantEntity } from "./homeAssistant";

export const VACUUM = "vacuum.roborock_q7_max";
/** The only vacuum actions the Pi server lets the kiosk run. */
export type VacuumAction = "start" | "pause" | "return_to_base" | "clean_area";
/** A room clean the Pi server knows by name. It sends Home Assistant the areas. */
export const LIVING_ROOM_AND_KITCHEN = "living_room_kitchen";
/** Consumables with this many hours of use left, or fewer, are shown. */
export const LOW_CONSUMABLE_HOURS = 10;

export type Consumable = { key: string; hoursLeft: number };

export type Vacuum = {
  entityId: string;
  name: string;
  state: string;
  status: string | null;
  error: string | null;
  battery: number | null;
  charging: boolean;
  waterShortage: boolean;
  cleaningMinutes: number | null;
  cleaningArea: number | null;
  lastClean: Date | null;
  /** Changes whenever Home Assistant has a new map. */
  mapVersion: string | null;
  consumables: Consumable[];
};

export type VacuumHeadline = { title: string; detail: string; tone: "ok" | "busy" | "problem" | "offline" };

const CONSUMABLES: Record<string, { name: string; verb: string }> = {
  main_brush: { name: "Main brush", verb: "replace" },
  side_brush: { name: "Side brush", verb: "replace" },
  filter: { name: "Filter", verb: "replace" },
  // Roborock counts the hours since its cliff and dock sensors were wiped.
  sensor: { name: "Sensors", verb: "clean" },
};

// Matches isUnavailable in homeAssistant.ts. Only types are imported, so Node runs the tests directly.
const isUnavailable = ({ state }: Pick<HomeAssistantEntity, "state">) => ["unavailable", "unknown"].includes(state.toLowerCase());

const HOURS_PER_UNIT: Record<string, number> = { s: 1 / 3600, min: 1 / 60, h: 1, d: 24 };

/** "main_brush_jammed" → "Main brush jammed" */
export function humanize(value: string) {
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function hours(entity: HomeAssistantEntity | undefined) {
  if (!entity || isUnavailable(entity)) return null;
  const value = Number(entity.state);
  const perUnit = HOURS_PER_UNIT[entity.attributes.unit_of_measurement ?? "h"];
  return Number.isFinite(value) && perUnit !== undefined ? value * perUnit : null;
}

/** The vacuum and its sensors, which the Roborock integration names after it (sensor.roborock_q7_max_battery). */
export function vacuumFrom(entities: HomeAssistantEntity[], entityId = VACUUM): Vacuum | null {
  const byId = new Map(entities.map((entity) => [entity.entityId, entity]));
  const vacuum = byId.get(entityId);
  if (!vacuum) return null;
  const objectId = entityId.slice(entityId.indexOf(".") + 1);
  const entity = (domain: string, suffix: string) => byId.get(`${domain}.${objectId}_${suffix}`);
  const text = (domain: string, suffix: string) => {
    const found = entity(domain, suffix);
    return found && !isUnavailable(found) ? found.state : null;
  };
  const numeric = (domain: string, suffix: string) => {
    const value = Number(text(domain, suffix) ?? Number.NaN);
    return Number.isFinite(value) ? value : null;
  };
  const error = text("sensor", "vacuum_error");
  const lastClean = Date.parse(text("sensor", "last_clean_end") ?? "");
  const cleaningHours = hours(entity("sensor", "cleaning_time"));
  const consumables: Consumable[] = [];
  const prefix = `sensor.${objectId}_`;
  for (const [id, found] of byId) {
    if (!id.startsWith(prefix) || !id.endsWith("_time_left")) continue;
    const hoursLeft = hours(found);
    if (hoursLeft !== null) consumables.push({ key: id.slice(prefix.length, -"_time_left".length), hoursLeft });
  }
  return {
    entityId,
    name: vacuum.name,
    state: vacuum.state.toLowerCase(),
    status: text("sensor", "status"),
    error: error && error !== "none" ? error : null,
    battery: numeric("sensor", "battery"),
    charging: text("binary_sensor", "charging") === "on",
    waterShortage: text("binary_sensor", "water_shortage") === "on",
    cleaningMinutes: cleaningHours === null ? null : Math.round(cleaningHours * 60),
    cleaningArea: numeric("sensor", "cleaning_area"),
    lastClean: Number.isFinite(lastClean) ? new Date(lastClean) : null,
    mapVersion: text("image", "map_0"),
    consumables,
  };
}

export function vacuumHeadline(vacuum: Vacuum): VacuumHeadline {
  const battery = vacuum.battery === null ? "" : `${Math.round(vacuum.battery)}%`;
  switch (vacuum.state) {
    case "unavailable":
    case "unknown":
      return { title: "Offline", detail: "The vacuum isn't answering", tone: "offline" };
    case "error":
      return { title: "Error", detail: vacuum.error ? humanize(vacuum.error) : "Check the vacuum", tone: "problem" };
    case "cleaning": {
      const progress = [
        vacuum.cleaningArea === null ? "" : `${vacuum.cleaningArea} m²`,
        vacuum.cleaningMinutes === null ? "" : `${vacuum.cleaningMinutes} min`,
      ].filter(Boolean).join(" · ");
      return { title: "Cleaning", detail: progress ? `${progress} so far` : "On its way round", tone: "busy" };
    }
    case "returning":
      return { title: "Returning to dock", detail: battery ? `Battery ${battery}` : "On its way home", tone: "busy" };
    case "paused":
      return { title: "Paused", detail: "Tap Resume to carry on", tone: "ok" };
    case "docked":
      if (vacuum.charging && vacuum.battery !== null && vacuum.battery < 100) return { title: "Docked", detail: `Charging · ${battery}`, tone: "ok" };
      return { title: "Docked", detail: vacuum.battery !== null && vacuum.battery >= 100 ? "Fully charged" : battery || "Ready to clean", tone: "ok" };
    case "idle":
      return { title: "Idle", detail: "Stopped away from the dock", tone: "ok" };
    default:
      return { title: humanize(vacuum.state), detail: vacuum.status ? humanize(vacuum.status) : "", tone: "ok" };
  }
}

/** Which buttons make sense right now. Start (Full clean) also resumes a paused clean. */
export function vacuumActions(vacuum: Vacuum): Record<VacuumAction, boolean> {
  if (vacuum.state === "unavailable" || vacuum.state === "unknown") return { start: false, clean_area: false, pause: false, return_to_base: false };
  return {
    start: vacuum.state !== "cleaning",
    clean_area: vacuum.state !== "cleaning",
    pause: vacuum.state === "cleaning" || vacuum.state === "returning",
    return_to_base: vacuum.state !== "docked" && vacuum.state !== "returning",
  };
}

export function lowConsumables(consumables: Consumable[], limitHours = LOW_CONSUMABLE_HOURS) {
  return consumables.filter((item) => item.hoursLeft <= limitHours).sort((left, right) => left.hoursLeft - right.hoursLeft);
}

/** "Filter: 10 h left", "Sensors: clean now" or "Main brush: replace now (242 h overdue)". */
export function consumableLabel({ key, hoursLeft }: Consumable) {
  const { name, verb } = CONSUMABLES[key] ?? { name: humanize(key), verb: "replace" };
  const rounded = Math.round(Math.abs(hoursLeft));
  if (hoursLeft >= 0.5) return `${name}: ${rounded} h left`;
  return hoursLeft <= -0.5 ? `${name}: ${verb} now (${rounded} h overdue)` : `${name}: ${verb} now`;
}
