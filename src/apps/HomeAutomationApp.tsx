import {
  Activity,
  Battery,
  CheckCircle2,
  DoorOpen,
  Fan,
  House,
  Lightbulb,
  Lock,
  Power,
  RefreshCw,
  Settings,
  Thermometer,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type HomeAssistantAttributes = {
  device_class?: string;
  unit_of_measurement?: string;
  brightness?: number;
  temperature?: number;
  current_temperature?: number;
  hvac_action?: string;
};

type HomeAssistantEntity = {
  entityId: string;
  domain: string;
  name: string;
  state: string;
  lastChanged?: string;
  attributes: HomeAssistantAttributes;
};

type HomeAssistantStatus = {
  configured: boolean;
  connected?: boolean;
  defaultUrl?: string;
  locationName?: string;
  version?: string;
  url?: string;
  entities?: HomeAssistantEntity[];
};

type HomeAssistantAction = "turn_on" | "turn_off";
type ControlFilter = "all" | "lights" | "switches";

const CONTROL_DOMAINS = new Set(["light", "switch", "fan", "input_boolean"]);
const USEFUL_SENSOR_CLASSES = new Set([
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

const FILTERS: Array<{ id: ControlFilter; label: string }> = [
  { id: "all", label: "All controls" },
  { id: "lights", label: "Lights" },
  { id: "switches", label: "Switches" },
];

function isOn(entity: HomeAssistantEntity) {
  const state = entity.state.toLowerCase();
  if (entity.domain === "lock") return state === "locked";
  if (entity.domain === "cover") return ["open", "opening"].includes(state);
  return state === "on";
}

function controlAction(entity: HomeAssistantEntity): HomeAssistantAction {
  return isOn(entity) ? "turn_off" : "turn_on";
}

function stateLabel(entity: HomeAssistantEntity) {
  const state = entity.state.toLowerCase();
  if (["unavailable", "unknown"].includes(state)) return "Unavailable";
  if (entity.domain === "person") return state === "home" ? "Home" : state === "not_home" ? "Away" : entity.state;
  if (entity.domain === "lock") return state === "locked" ? "Locked" : "Unlocked";
  if (entity.domain === "cover") return entity.state.charAt(0).toUpperCase() + entity.state.slice(1);
  if (["light", "switch", "fan", "input_boolean"].includes(entity.domain)) return isOn(entity) ? "On" : "Off";
  if (entity.domain === "climate") {
    const temperature = entity.attributes.current_temperature ?? entity.attributes.temperature;
    return temperature === undefined ? entity.state : `${temperature}° · ${entity.state}`;
  }
  if (entity.domain === "binary_sensor") {
    const active = state === "on";
    const deviceClass = entity.attributes.device_class;
    if (["door", "garage_door", "window", "opening"].includes(deviceClass ?? "")) return active ? "Open" : "Closed";
    if (["motion", "occupancy", "presence"].includes(deviceClass ?? "")) return active ? "Detected" : "Clear";
    return active ? "On" : "Off";
  }
  const numericState = Number(entity.state);
  if (Number.isFinite(numericState)) {
    const maximumFractionDigits = ["battery", "humidity"].includes(entity.attributes.device_class ?? "")
      ? 0
      : entity.attributes.device_class === "energy" ? 2 : 1;
    const formatted = new Intl.NumberFormat("en-AU", { maximumFractionDigits }).format(numericState);
    return `${formatted}${entity.attributes.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : ""}`;
  }
  return `${entity.state}${entity.attributes.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : ""}`;
}

function EntityIcon({ entity }: { entity: HomeAssistantEntity }) {
  if (entity.domain === "light") return <Lightbulb />;
  if (entity.domain === "fan") return <Fan />;
  if (entity.domain === "lock") return <Lock />;
  if (entity.domain === "cover" || ["door", "window", "garage_door", "opening"].includes(entity.attributes.device_class ?? "")) return <DoorOpen />;
  if (entity.domain === "climate" || entity.attributes.device_class === "temperature") return <Thermometer />;
  if (entity.attributes.device_class === "battery") return <Battery />;
  if (entity.domain === "person") return <UserRound />;
  if (entity.domain === "switch" || entity.domain === "input_boolean") return <Power />;
  return <Activity />;
}

function matchesFilter(entity: HomeAssistantEntity, filter: ControlFilter) {
  if (filter === "all") return true;
  if (filter === "lights") return entity.domain === "light";
  return ["switch", "fan", "input_boolean"].includes(entity.domain);
}

export function HomeAutomationApp() {
  const [status, setStatus] = useState<HomeAssistantStatus | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ControlFilter>("all");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [url, setUrl] = useState("http://homeassistant.local:8123");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/home-assistant/status", { cache: "no-store" });
      const body = await response.json() as HomeAssistantStatus & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not reach Home Assistant");
      setStatus(body);
      setUrl(body.url ?? body.defaultUrl ?? "http://homeassistant.local:8123");
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reach Home Assistant");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const entities = status?.entities ?? [];
  const people = useMemo(() => entities.filter((entity) => entity.domain === "person"), [entities]);
  const peopleHome = people.filter((person) => person.state.toLowerCase() === "home").length;
  const controls = useMemo(() => entities
    .filter((entity) => CONTROL_DOMAINS.has(entity.domain))
    .filter((entity) => showUnavailable || !["unavailable", "unknown"].includes(entity.state.toLowerCase()))
    .filter((entity) => matchesFilter(entity, filter))
    .sort((left, right) => Number(isOn(right)) - Number(isOn(left)) || left.name.localeCompare(right.name)), [entities, filter, showUnavailable]);
  const sensors = useMemo(() => entities
    .filter((entity) => entity.domain === "climate" || entity.domain === "weather" || entity.domain === "lock" || entity.domain === "cover" || (entity.domain === "sensor" || entity.domain === "binary_sensor") && USEFUL_SENSOR_CLASSES.has(entity.attributes.device_class ?? ""))
    .filter((entity) => !["unavailable", "unknown"].includes(entity.state.toLowerCase()))
    .slice(0, 12), [entities]);

  const runAction = async (entity: HomeAssistantEntity) => {
    if (pending.has(entity.entityId) || ["unavailable", "unknown"].includes(entity.state.toLowerCase())) return;
    const action = controlAction(entity);
    setPending((current) => new Set(current).add(entity.entityId));
    setStatus((current) => current ? {
      ...current,
      entities: current.entities?.map((item) => item.entityId === entity.entityId
        ? { ...item, state: action === "turn_on" ? "on" : "off" }
        : item),
    } : current);
    try {
      const response = await fetch("/api/home-assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: entity.entityId, action }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "The control did not respond");
      window.setTimeout(() => void refresh(), 500);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The control did not respond");
      void refresh();
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(entity.entityId);
        return next;
      });
    }
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || !token.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/home-assistant/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), token: token.trim() }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not connect Home Assistant");
      setToken("");
      setShowSettings(false);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not connect Home Assistant");
    } finally {
      setSaving(false);
    }
  };

  const configured = status?.configured === true;
  const connected = configured && status?.connected === true;

  return (
    <section className="home-automation-app">
      <header className="home-automation-header">
        <div>
          <p className="eyebrow">Home Assistant</p>
          <h1>Home controls</h1>
          <p className="header-note">See what is happening and control the house.</p>
        </div>
        <div className={`home-connection-card ${connected ? "connected" : ""}`}>
          {connected ? <Wifi /> : <WifiOff />}
          <span><strong>{connected ? status.locationName ?? "Home" : configured ? "Offline" : "Not connected"}</strong>{connected ? `${peopleHome} of ${people.length} people home` : "Home Assistant"}</span>
        </div>
      </header>

      <div className="home-automation-board">
        {!configured && status && (
          <div className="home-connect-empty">
            <span><House /></span>
            <h2>Connect your home</h2>
            <p>Cannvas found Home Assistant on your network. Add a long-lived access token once, then the mirror can show and control your devices.</p>
            <button className="button primary" onClick={() => setShowSettings(true)}><Settings /> Connect Home Assistant</button>
          </div>
        )}

        {!status && !error && <div className="home-loading"><RefreshCw /> Loading your home…</div>}

        {connected && (
          <div className="home-dashboard-scroll">
            <section className="home-presence-section">
              <div className="home-section-title"><div><span>At home now</span><h2>Our family</h2></div><strong>{peopleHome} home</strong></div>
              <div className="home-presence-grid">
                {people.map((person) => (
                  <article className={person.state.toLowerCase() === "home" ? "home-person-card is-home" : "home-person-card"} key={person.entityId}>
                    <span className="home-person-avatar">{person.name.charAt(0).toUpperCase()}</span>
                    <div><strong>{person.name}</strong><small>{stateLabel(person)}</small></div>
                    {person.state.toLowerCase() === "home" ? <CheckCircle2 /> : <House />}
                  </article>
                ))}
                {people.length === 0 && <p className="home-section-empty">Add Person entities in Home Assistant to see who is home.</p>}
              </div>
            </section>

            <section className="home-control-section">
              <div className="home-section-title"><div><span>Tap to control</span><h2>Devices</h2></div><strong>{controls.filter(isOn).length} active</strong></div>
              <div className="home-filter-row" role="group" aria-label="Filter home controls">
                {FILTERS.map((option) => <button className={filter === option.id ? "active" : ""} key={option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}
                <label className="home-unavailable-filter"><input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} /><span>Show unavailable</span></label>
              </div>
              <div className="home-device-grid">
                {controls.map((entity) => (
                  <button
                    className={`home-device-card ${isOn(entity) ? "is-on" : ""}`}
                    key={entity.entityId}
                    onClick={() => void runAction(entity)}
                    disabled={pending.has(entity.entityId) || ["unavailable", "unknown"].includes(entity.state.toLowerCase())}
                    aria-pressed={isOn(entity)}
                  >
                    <span className="home-device-icon"><EntityIcon entity={entity} /></span>
                    <span className="home-device-copy"><strong>{entity.name}</strong><small>{stateLabel(entity)}</small></span>
                    <span className="home-device-toggle"><i /></span>
                  </button>
                ))}
                {controls.length === 0 && <p className="home-section-empty">No matching controls found.</p>}
              </div>
            </section>

            {sensors.length > 0 && (
              <section className="home-sensor-section">
                <div className="home-section-title"><div><span>Live status</span><h2>At a glance</h2></div></div>
                <div className="home-sensor-grid">
                  {sensors.map((entity) => <article key={entity.entityId}><span><EntityIcon entity={entity} /></span><div><strong>{stateLabel(entity)}</strong><small>{entity.name}</small></div></article>)}
                </div>
              </section>
            )}
          </div>
        )}

        {error && <div className="home-error" role="alert"><WifiOff /><span><strong>Home Assistant needs attention</strong>{error}</span></div>}

        <footer className="home-automation-actions app-control-palette">
          <button className="button secondary" onClick={() => void refresh()} disabled={!configured}><RefreshCw /> Refresh</button>
          <button className="button primary" onClick={() => setShowSettings(true)}><Settings /> {configured ? "Connection" : "Connect"}</button>
        </footer>
      </div>

      {showSettings && (
        <div className="dialog-backdrop home-settings-backdrop" role="presentation" onPointerDown={() => setShowSettings(false)}>
          <form className="dialog-card home-settings-card" onSubmit={(event) => void saveSettings(event)} onPointerDown={(event) => event.stopPropagation()}>
            <div className="dialog-symbol info"><House /></div>
            <h2>Connect Home Assistant</h2>
            <p>The token is stored only on this mirror. In Home Assistant, open your profile and create a Long-Lived Access Token.</p>
            <label><span>Home Assistant address</span><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} autoComplete="off" inputMode="url" /></label>
            <label><span>Long-lived access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder={configured ? "Enter a new token to reconnect" : "Paste token here"} /></label>
            {error && <div className="home-settings-error">{error}</div>}
            <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setShowSettings(false)}>Cancel</button><button className="button primary" type="submit" disabled={!url.trim() || !token.trim() || saving}>{saving ? "Connecting…" : "Connect"}</button></div>
          </form>
        </div>
      )}
    </section>
  );
}
