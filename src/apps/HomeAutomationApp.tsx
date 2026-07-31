import {
  Activity,
  Battery,
  Check,
  CheckCircle2,
  DoorOpen,
  Download,
  Fan,
  House,
  Lightbulb,
  Lock,
  Network,
  Power,
  RefreshCw,
  Settings,
  Thermometer,
  Upload,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useState } from "react";

type HomeAssistantAttributes = {
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
  network?: NetworkStatus;
};

type NetworkClient = {
  name: string;
  ip?: string;
  network: string;
  isWired: boolean;
  signal?: number;
  satisfaction?: number;
  downloadBps: number;
  uploadBps: number;
};

type NetworkStatus = {
  configured: boolean;
  connected?: boolean;
  online?: number;
  downloadBps?: number;
  uploadBps?: number;
  clients?: NetworkClient[];
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

const FAMILY = [
  { id: "mike", name: "Mike", avatar: "/avatars/dad.png", matches: ["mike", "cann"] },
  { id: "kelsie", name: "Kelsie", avatar: "/avatars/mum.png", matches: ["kelsie", "kels"] },
] as const;

function familyMemberFor(person: HomeAssistantEntity) {
  const haystack = `${person.entityId} ${person.name}`.toLowerCase();
  return FAMILY.find((member) => member.matches.some((match) => haystack.includes(match)));
}

function HomeLocationMap({ people }: { people: HomeAssistantEntity[] }) {
  const locations = people
    .map((person) => ({
      person,
      latitude: Number(person.attributes.latitude),
      longitude: Number(person.attributes.longitude),
    }))
    .filter(({ latitude, longitude }) => Number.isFinite(latitude) && Number.isFinite(longitude));
  const locationGroups = Array.from(locations.reduce((groups, location) => {
    // Trackers at home normally report identical coordinates. Group anything
    // within roughly ten metres so one family member cannot hide another.
    const key = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
    const group = groups.get(key) ?? [];
    group.push(location);
    groups.set(key, group);
    return groups;
  }, new Map<string, typeof locations>()).values()).map((group) => ({
    locations: group,
    latitude: group.reduce((sum, location) => sum + location.latitude, 0) / group.length,
    longitude: group.reduce((sum, location) => sum + location.longitude, 0) / group.length,
  }));
  const locationKey = JSON.stringify(locations.map(({ person, latitude, longitude }) => [person.entityId, latitude, longitude]));

  useEffect(() => {
    if (locations.length === 0) return;
    const container = document.querySelector<HTMLElement>("#home-location-map");
    if (!container) return;

    // Leaflet stores its instance on the element, so remove an old map before
    // rebuilding it with the latest Home Assistant coordinates.
    if ((container as HTMLElement & { _leaflet_id?: number })._leaflet_id) {
      (container as HTMLElement & { _leaflet_id?: number })._leaflet_id = undefined;
      container.replaceChildren();
    }

    const map = L.map(container, { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    locationGroups.forEach(({ locations: groupedLocations, latitude, longitude }) => {
      const avatars = groupedLocations.map(({ person }) => familyMemberFor(person)?.avatar ?? "/avatars/dad.png");
      const grouped = groupedLocations.length > 1;
      const iconWidth = grouped ? 94 : 58;
      const marker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: `home-location-marker${grouped ? " is-group" : ""}`,
          html: `<span>${avatars.map((avatar) => `<b><img src="${avatar}" alt=""><i></i></b>`).join("")}</span>`,
          iconSize: [iconWidth, 66],
          iconAnchor: [iconWidth / 2, 62],
        }),
      }).addTo(map);
      marker.bindTooltip(groupedLocations.map(({ person }) => person.name).join(" & "), {
        permanent: true,
        direction: "right",
        offset: [grouped ? 34 : 18, -31],
        className: "home-location-label",
      });
      bounds.extend([latitude, longitude]);
    });

    if (locationGroups.length === 1) map.setView(bounds.getCenter(), 15);
    else map.fitBounds(bounds.pad(.35), { maxZoom: 15 });
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
    };
    // The serialized key changes only when a person's coordinates change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey]);

  if (locations.length === 0) {
    return <div className="home-location-empty"><House /> Location will appear when a person tracker reports GPS coordinates.</div>;
  }
  return <div id="home-location-map" className="home-location-map" aria-label="Map showing family locations" />;
}

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

function formatRate(bytesPerSecond = 0) {
  const bitsPerSecond = Math.max(0, bytesPerSecond) * 8;
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(bitsPerSecond >= 10_000_000 ? 0 : 1)} Mbps`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(bitsPerSecond >= 100_000 ? 0 : 1)} Kbps`;
  return `${Math.round(bitsPerSecond)} bps`;
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

  const refreshNetwork = useCallback(async () => {
    try {
      const response = await fetch("/api/unifi/status", { cache: "no-store" });
      const network = await response.json() as NetworkStatus;
      if (!response.ok) return;
      setStatus((current) => current ? { ...current, network } : current);
    } catch {
      // Keep the last good reading during a brief controller or Wi-Fi blip.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => void refreshNetwork(), 1_000);
    return () => window.clearInterval(timer);
  }, [refreshNetwork]);

  const entities = status?.entities ?? [];
  const people = useMemo(() => entities.filter((entity) => entity.domain === "person"), [entities]);
  const family = useMemo(() => FAMILY.map((member) => ({
    ...member,
    person: people.find((person) => member.matches.some((match) => `${person.entityId} ${person.name}`.toLowerCase().includes(match))),
  })), [people]);
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
  const networkClients = useMemo(() => [...(status?.network?.clients ?? [])]
    .sort((left, right) => right.downloadBps + right.uploadBps - left.downloadBps - left.uploadBps)
    .slice(0, 8), [status?.network?.clients]);

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
          <span><strong>{connected ? status.locationName ?? "Home" : configured ? "Offline" : "Not connected"}</strong>{connected ? `${peopleHome} tracked ${peopleHome === 1 ? "person" : "people"} home` : "Home Assistant"}</span>
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
                {family.map(({ id, name, avatar, person }) => (
                  <article className={person?.state.toLowerCase() === "home" ? "home-person-card is-home" : `home-person-card${person ? "" : " needs-setup"}`} key={id}>
                    <img className="home-person-avatar" src={avatar} alt={`${name}'s face`} />
                    <div><strong>{name}</strong><small>{person ? stateLabel(person) : "Wi-Fi setup needed"}</small></div>
                    {person?.state.toLowerCase() === "home" ? <CheckCircle2 /> : person ? <House /> : <WifiOff />}
                  </article>
                ))}
              </div>
            </section>

            <section className="home-location-section">
              <div className="home-section-title"><div><span>Live location</span><h2>Where we are</h2></div></div>
              <HomeLocationMap people={people} />
            </section>

            {status.network?.configured && (
              <section className="home-network-section">
                <div className="home-section-title">
                  <div><span>UniFi network</span><h2>Connected now</h2></div>
                  <strong>{status.network.connected ? `${status.network.online ?? 0} online` : "Offline"}</strong>
                </div>
                {status.network.connected ? (
                  <>
                    <div className="home-network-summary">
                      <article><span><Network /></span><div><strong>{status.network.online ?? 0}</strong><small>Devices online</small></div></article>
                      <article><span className="download"><Download /></span><div><strong>{formatRate(status.network.downloadBps)}</strong><small>Internet download</small></div></article>
                      <article><span className="upload"><Upload /></span><div><strong>{formatRate(status.network.uploadBps)}</strong><small>Internet upload</small></div></article>
                    </div>
                    <div className="home-network-clients">
                      {networkClients.map((client) => (
                        <article key={`${client.name}-${client.ip ?? client.network}`}>
                          <span className="home-network-client-icon"><Wifi /></span>
                          <div className="home-network-client-name"><strong>{client.name}</strong><small>{client.ip ?? "No IP"} · {client.isWired ? "Wired" : client.network}</small></div>
                          <div className="home-network-rate download"><Download /><strong>{formatRate(client.downloadBps)}</strong></div>
                          <div className="home-network-rate upload"><Upload /><strong>{formatRate(client.uploadBps)}</strong></div>
                        </article>
                      ))}
                    </div>
                  </>
                ) : <p className="home-section-empty">UniFi is connected to Home Assistant, but the controller is not responding right now.</p>}
              </section>
            )}

            <section className="home-control-section">
              <div className="home-section-title"><div><span>Tap to control</span><h2>Devices</h2></div><strong>{controls.filter(isOn).length} active</strong></div>
              <div className="home-filter-row" role="group" aria-label="Filter home controls">
                {FILTERS.map((option) => <button className={filter === option.id ? "active" : ""} key={option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}
                <button className="home-unavailable-filter" onClick={() => setShowUnavailable((current) => !current)} aria-pressed={showUnavailable}><span className="home-unavailable-checkbox">{showUnavailable && <Check />}</span><span>Show unavailable</span></button>
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
