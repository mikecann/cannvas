import {
  Activity,
  Battery,
  Check,
  CheckCircle2,
  DoorOpen,
  Fan,
  House,
  Lightbulb,
  Lock,
  Power,
  RefreshCw,
  Settings,
  Sparkles,
  Thermometer,
  Tv,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useMemo, useState } from "react";
import { scheduleHomeActionRefresh } from "../lib/actionTiming";
import {
  CONTROL_DOMAINS,
  type ControlFilter,
  controlAction,
  DEFAULT_HOME_ASSISTANT_URL,
  type HomeAssistantEntity,
  type HomeAssistantStatus,
  isGlanceSensor,
  isHome,
  isOn,
  isOpeningSensor,
  isRoutine,
  isUnavailable,
  matchesFilter,
  type NetworkStatus,
  stateLabel,
} from "../lib/homeAssistant";
import { errorText, readJsonResponse } from "../lib/http";
import { usePolling } from "../lib/usePolling";
import { FAMILY } from "./home/family";
import { HomeLocationMap } from "./home/HomeLocationMap";
import { HomeNetworkSection } from "./home/HomeNetworkSection";
import { HomeSettingsDialog } from "./home/HomeSettingsDialog";

const STATUS_REFRESH_MS = 15_000;
// UniFi rates are live numbers, but the Pi only needs to ask every few seconds.
const NETWORK_REFRESH_MS = 4_000;

const FILTERS: Array<{ id: ControlFilter; label: string }> = [
  { id: "all", label: "All controls" },
  { id: "lights", label: "Lights" },
  { id: "switches", label: "Switches" },
  { id: "media", label: "TV & media" },
  { id: "routines", label: "Routines" },
];

function EntityIcon({ entity }: { entity: HomeAssistantEntity }) {
  if (entity.domain === "light") return <Lightbulb />;
  if (entity.domain === "fan") return <Fan />;
  if (entity.domain === "lock") return <Lock />;
  if (entity.domain === "cover" || isOpeningSensor(entity)) return <DoorOpen />;
  if (entity.domain === "climate" || entity.attributes.device_class === "temperature") return <Thermometer />;
  if (entity.attributes.device_class === "battery") return <Battery />;
  if (entity.domain === "person") return <UserRound />;
  if (entity.domain === "switch" || entity.domain === "input_boolean") return <Power />;
  if (entity.domain === "media_player") return <Tv />;
  if (isRoutine(entity)) return <Sparkles />;
  return <Activity />;
}

export function HomeAutomationApp() {
  const [status, setStatus] = useState<HomeAssistantStatus | null>(null);
  const [network, setNetwork] = useState<NetworkStatus | undefined>(undefined);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ControlFilter>("all");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [showSettings, setShowSettings] = useState(false);

  const refresh = usePolling(async () => {
    try {
      const response = await fetch("/api/home-assistant/status", { cache: "no-store" });
      const body = await readJsonResponse<HomeAssistantStatus>(response, "Could not reach Home Assistant");
      setStatus(body);
      setNetwork(body.network);
      setError("");
    } catch (requestError) {
      setError(errorText(requestError, "Could not reach Home Assistant"));
    }
  }, STATUS_REFRESH_MS);

  usePolling(async () => {
    try {
      const response = await fetch("/api/unifi/status", { cache: "no-store" });
      setNetwork(await readJsonResponse<NetworkStatus>(response, "UniFi is unavailable"));
    } catch {
      // Keep the last good reading during a brief controller or Wi-Fi blip.
    }
  }, NETWORK_REFRESH_MS, { enabled: network?.configured === true, immediate: false });

  const entities = useMemo(() => status?.entities ?? [], [status?.entities]);
  const people = useMemo(() => entities.filter((entity) => entity.domain === "person"), [entities]);
  const family = useMemo(() => FAMILY.map((member) => ({
    ...member,
    person: people.find((person) => member.matches.some((match) => `${person.entityId} ${person.name}`.toLowerCase().includes(match))),
  })), [people]);
  const peopleHome = people.filter(isHome).length;
  const controls = useMemo(() => entities
    .filter((entity) => CONTROL_DOMAINS.has(entity.domain))
    .filter((entity) => showUnavailable || !isUnavailable(entity))
    .filter((entity) => matchesFilter(entity, filter))
    .sort((left, right) => Number(isOn(right)) - Number(isOn(left)) || left.name.localeCompare(right.name)), [entities, filter, showUnavailable]);
  const sensors = useMemo(() => entities.filter(isGlanceSensor).slice(0, 12), [entities]);

  const releasePending = (entityId: string) => setPending((current) => {
    const next = new Set(current);
    next.delete(entityId);
    return next;
  });

  const runAction = async (entity: HomeAssistantEntity) => {
    if (pending.has(entity.entityId) || isUnavailable(entity)) return;
    const action = controlAction(entity);
    const routine = isRoutine(entity);
    let deferPendingRelease = false;
    setPending((current) => new Set(current).add(entity.entityId));
    // Scenes and scripts report their last-run time instead of an on/off state,
    // so only optimistic-update controls that behave like switches.
    if (!routine) {
      setStatus((current) => current ? {
        ...current,
        entities: current.entities?.map((item) => item.entityId === entity.entityId
          ? { ...item, state: action === "turn_on" ? "on" : "off" }
          : item),
      } : current);
    }
    try {
      const response = await fetch("/api/home-assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId: entity.entityId, action }),
      });
      await readJsonResponse(response, "The control did not respond");
      deferPendingRelease = scheduleHomeActionRefresh({
        isRoutine: routine,
        refresh,
        releasePending: () => releasePending(entity.entityId),
      });
    } catch (requestError) {
      setError(errorText(requestError, "The control did not respond"));
      void refresh();
    } finally {
      if (!deferPendingRelease) releasePending(entity.entityId);
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
                  <article className={person && isHome(person) ? "home-person-card is-home" : `home-person-card${person ? "" : " needs-setup"}`} key={id}>
                    <img className="home-person-avatar" src={avatar} alt={`${name}'s face`} />
                    <div><strong>{name}</strong><small>{person ? stateLabel(person) : "Wi-Fi setup needed"}</small></div>
                    {person && isHome(person) ? <CheckCircle2 /> : person ? <House /> : <WifiOff />}
                  </article>
                ))}
              </div>
            </section>

            <section className="home-location-section">
              <div className="home-section-title"><div><span>Live location</span><h2>Where we are</h2></div></div>
              <HomeLocationMap people={people} />
            </section>

            {network?.configured && <HomeNetworkSection network={network} />}

            <section className="home-control-section">
              <div className="home-section-title"><div><span>Tap to control</span><h2>Devices</h2></div><strong>{controls.filter(isOn).length} active</strong></div>
              <div className="home-filter-row" role="group" aria-label="Filter home controls">
                {FILTERS.map((option) => <button className={filter === option.id ? "active" : ""} key={option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}
                <button className="home-unavailable-filter" onClick={() => setShowUnavailable((current) => !current)} aria-pressed={showUnavailable}><span className="home-unavailable-checkbox">{showUnavailable && <Check />}</span><span>Show unavailable</span></button>
              </div>
              <div className="home-device-grid">
                {controls.map((entity) => (
                  <button
                    className={`home-device-card ${isOn(entity) ? "is-on" : ""}${isRoutine(entity) ? " is-action" : ""}`}
                    key={entity.entityId}
                    onClick={() => void runAction(entity)}
                    disabled={pending.has(entity.entityId) || isUnavailable(entity)}
                    aria-pressed={isRoutine(entity) ? undefined : isOn(entity)}
                  >
                    <span className="home-device-icon"><EntityIcon entity={entity} /></span>
                    <span className="home-device-copy"><strong>{entity.name}</strong><small>{stateLabel(entity)}</small></span>
                    {isRoutine(entity)
                      ? <span className="home-device-action"><Sparkles /></span>
                      : <span className="home-device-toggle"><i /></span>}
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
        <HomeSettingsDialog
          initialUrl={status?.url ?? status?.defaultUrl ?? DEFAULT_HOME_ASSISTANT_URL}
          configured={configured}
          onClose={() => setShowSettings(false)}
          onConnected={refresh}
        />
      )}
    </section>
  );
}
