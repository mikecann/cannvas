// Shapes and state checks for the Home Assistant data the Pi server sends.
// Kept free of React so the rules can be tested directly.

export type HomeAssistantAttributes = {
  device_class?: string;
  unit_of_measurement?: string;
  brightness?: number;
  temperature?: number;
  current_temperature?: number;
  hvac_action?: string;
  latitude?: number;
  longitude?: number;
  gps_accuracy?: number;
};

export type HomeAssistantEntity = {
  entityId: string;
  domain: string;
  name: string;
  state: string;
  lastChanged?: string;
  attributes: HomeAssistantAttributes;
};

export type NetworkClient = {
  name: string;
  ip?: string;
  network: string;
  isWired: boolean;
  signal?: number;
  satisfaction?: number;
  downloadBps: number;
  uploadBps: number;
};

export type NetworkStatus = {
  configured: boolean;
  connected?: boolean;
  online?: number;
  downloadBps?: number;
  uploadBps?: number;
  clients?: NetworkClient[];
};

export type HomeAssistantStatus = {
  configured: boolean;
  connected?: boolean;
  defaultUrl?: string;
  locationName?: string;
  version?: string;
  url?: string;
  entities?: HomeAssistantEntity[];
  network?: NetworkStatus;
};

export type HomeAssistantAction = "turn_on" | "turn_off";
export type ControlFilter = "all" | "lights" | "switches" | "media" | "routines";

export const DEFAULT_HOME_ASSISTANT_URL = "http://homeassistant.local:8123";
export const CONTROL_DOMAINS = new Set(["light", "switch", "fan", "input_boolean", "media_player", "scene", "script"]);
const SWITCH_DOMAINS = ["switch", "fan", "input_boolean"];
const OPENING_CLASSES = ["door", "garage_door", "window", "opening"];
const PRESENCE_CLASSES = ["motion", "occupancy", "presence"];
export const USEFUL_SENSOR_CLASSES = new Set([
  "battery",
  "carbon_dioxide",
  "carbon_monoxide",
  "door",
  "energy",
  "gas",
  "humidity",
  "moisture",
  "motion",
  "power",
  "presence",
  "problem",
  "smoke",
  "temperature",
  "window",
]);

const stateOf = (entity: Pick<HomeAssistantEntity, "state">) => entity.state.toLowerCase();

/** Home Assistant reports a device it cannot reach as "unavailable" or "unknown". */
export function isUnavailable(entity: Pick<HomeAssistantEntity, "state">) {
  const state = stateOf(entity);
  return state === "unavailable" || state === "unknown";
}

/** Scenes and scripts run once. They have no on or off state. */
export function isRoutine(entity: Pick<HomeAssistantEntity, "domain">) {
  return entity.domain === "scene" || entity.domain === "script";
}

export function isHome(person: Pick<HomeAssistantEntity, "state">) {
  return stateOf(person) === "home";
}

export function isOpeningSensor(entity: HomeAssistantEntity) {
  return OPENING_CLASSES.includes(entity.attributes.device_class ?? "");
}

export function isOn(entity: HomeAssistantEntity) {
  const state = stateOf(entity);
  if (entity.domain === "lock") return state === "locked";
  if (entity.domain === "cover") return state === "open" || state === "opening";
  if (entity.domain === "media_player") return !["off", "standby", "unavailable", "unknown"].includes(state);
  return state === "on";
}

export function controlAction(entity: HomeAssistantEntity): HomeAssistantAction {
  if (isRoutine(entity)) return "turn_on";
  return isOn(entity) ? "turn_off" : "turn_on";
}

export function stateLabel(entity: HomeAssistantEntity) {
  const state = stateOf(entity);
  const unit = entity.attributes.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : "";
  if (isUnavailable(entity)) return "Unavailable";
  if (entity.domain === "person") return state === "home" ? "Home" : state === "not_home" ? "Away" : entity.state;
  // Jammed, locking and unlocking must not read as a plain "Unlocked".
  if (entity.domain === "lock") return state === "locked" ? "Locked" : state === "unlocked" ? "Unlocked" : entity.state.charAt(0).toUpperCase() + entity.state.slice(1);
  if (entity.domain === "cover") return entity.state.charAt(0).toUpperCase() + entity.state.slice(1);
  if (SWITCH_DOMAINS.includes(entity.domain) || entity.domain === "light" || entity.domain === "media_player") {
    return isOn(entity) ? "On" : "Off";
  }
  if (isRoutine(entity)) return "Run";
  if (entity.domain === "climate") {
    const temperature = entity.attributes.current_temperature ?? entity.attributes.temperature;
    return temperature === undefined ? entity.state : `${temperature}° · ${entity.state}`;
  }
  if (entity.domain === "binary_sensor") {
    const active = state === "on";
    if (isOpeningSensor(entity)) return active ? "Open" : "Closed";
    if (PRESENCE_CLASSES.includes(entity.attributes.device_class ?? "")) return active ? "Detected" : "Clear";
    return active ? "On" : "Off";
  }
  const numericState = Number(entity.state);
  if (Number.isFinite(numericState)) {
    const maximumFractionDigits = ["battery", "humidity"].includes(entity.attributes.device_class ?? "")
      ? 0
      : entity.attributes.device_class === "energy" ? 2 : 1;
    return `${new Intl.NumberFormat("en-AU", { maximumFractionDigits }).format(numericState)}${unit}`;
  }
  return `${entity.state}${unit}`;
}

export function matchesFilter(entity: HomeAssistantEntity, filter: ControlFilter) {
  if (filter === "all") return true;
  if (filter === "lights") return entity.domain === "light";
  if (filter === "switches") return SWITCH_DOMAINS.includes(entity.domain);
  if (filter === "media") return entity.domain === "media_player";
  return isRoutine(entity);
}

export function isGlanceSensor(entity: HomeAssistantEntity) {
  if (isUnavailable(entity)) return false;
  if (["climate", "weather", "lock", "cover"].includes(entity.domain)) return true;
  return (entity.domain === "sensor" || entity.domain === "binary_sensor")
    && USEFUL_SENSOR_CLASSES.has(entity.attributes.device_class ?? "");
}

export function formatRate(bytesPerSecond = 0) {
  const bitsPerSecond = Math.max(0, bytesPerSecond) * 8;
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond >= 10_000_000 ? 0 : 1)} Mbps`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(bitsPerSecond >= 100_000 ? 0 : 1)} Kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
}
