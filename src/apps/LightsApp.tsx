import { LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, readJsonResponse } from "../lib/http";
import { type LightString, type LightsStatus, signalBars, useLights } from "../lib/lights";

// The outdoor Christmas lights: the main plug, and how each WLED string is
// connected. Far strings belong on the extender; one stuck on the indoor
// access point stutters, and a restart usually moves it across.
export function LightsApp() {
  const lights = useLights(5000);
  const status = lights.state.kind === "ready" ? lights.state.lights : null;

  return (
    <section className="lights-app">
      <h1>Lights</h1>
      {lights.state.kind === "loading" && <div className="car-message">Checking the lights…</div>}
      {lights.state.kind === "error" && <div className="car-message">{lights.state.message}</div>}
      {status && !status.configured && <div className="car-message">Connect Home Assistant in Home controls to see the lights.</div>}
      {status?.configured && (
        <>
          <LightsPower lights={status} refresh={lights.refresh} />
          {status.on && <LightsStrings strings={status.strings ?? []} refresh={lights.refresh} />}
          {/* Home Assistant's "When Sunset Turn Outside Lights On" and "Turn off Outside Lights at 10pm" automations. */}
          <p className="lights-footnote">Comes on at sunset, off at 10pm</p>
        </>
      )}
    </section>
  );
}

const ACTION_LIMIT_MS = 10_000;

function LightsPower({ lights, refresh }: { lights: LightsStatus; refresh: () => void | Promise<void> }) {
  // The state we asked for, until the plug reports it.
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pending !== null && lights.on === pending) setPending(null);
  }, [pending, lights.on]);

  async function toggle() {
    const on = !lights.on;
    setError(null);
    setPending(on);
    try {
      await readJsonResponse(await fetch("/api/lights/power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
        signal: AbortSignal.timeout(ACTION_LIMIT_MS),
      }), "Home Assistant didn't answer");
      void refresh();
    } catch (err) {
      setPending(null);
      setError(errorText(err, "Home Assistant didn't answer"));
    }
  }

  const strings = lights.strings ?? [];
  const playing = strings.filter((s) => s.online && s.playing).length;
  let detail: string | null;
  if (lights.on == null) detail = "Can't reach the plug";
  else if (!lights.on) detail = null;
  else if (strings.length === 0) detail = "Starting up…";
  else detail = `${playing} of ${strings.length} strings playing`;
  const watts = lights.on && lights.watts != null ? `${Math.round(lights.watts)} W · ` : "";

  return (
    <div className="lights-power">
      <div>
        <strong>{lights.on ? "On" : "Off"}</strong>
        {detail && <span>{watts}{detail}</span>}
        {error && <span className="lights-error">{error}</span>}
      </div>
      <button type="button" className="lights-power-button" onClick={toggle} disabled={pending !== null || lights.on == null}>
        {pending !== null ? <><LoaderCircle className="spin" /> {pending ? "Turning on" : "Turning off"}</> : lights.on ? "Turn off" : "Turn on"}
      </button>
    </div>
  );
}

// A restarted board drops off for about 15 s, then needs a poll or two to show up again.
const RESTART_SETTLE_MS = 40_000;

function LightsStrings({ strings, refresh }: { strings: LightString[]; refresh: () => void | Promise<void> }) {
  const [restarting, setRestarting] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  async function restart(string: number) {
    setError(null);
    setRestarting((current) => ({ ...current, [string]: Date.now() }));
    const clear = () => setRestarting(({ [string]: _, ...rest }) => rest);
    try {
      await readJsonResponse(await fetch("/api/lights/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ string }),
        signal: AbortSignal.timeout(ACTION_LIMIT_MS),
      }), `String ${string} didn't answer`);
      timers.current.push(window.setTimeout(() => { clear(); void refresh(); }, RESTART_SETTLE_MS));
    } catch (err) {
      clear();
      setError(errorText(err, `String ${string} didn't answer`));
    }
  }

  if (strings.length === 0) return null;
  return (
    <div className="lights-strings">
      {error && <div className="lights-error lights-strings-error">{error}</div>}
      {strings.map((s) => (
        <LightRow key={s.string} light={s} restarting={s.string in restarting} onRestart={() => restart(s.string)} />
      ))}
    </div>
  );
}

function LightRow({ light, restarting, onRestart }: { light: LightString; restarting: boolean; onRestart: () => void }) {
  const bars = light.online ? signalBars(light.rssi) : 0;
  let detail: string;
  if (restarting) detail = "Restarting…";
  else if (!light.online) detail = "Not answering";
  else detail = `${light.via === "extender" ? "Extender" : light.via === "indoor" ? "Indoor access point" : "Wi-Fi"}${light.rssi != null ? ` · ${Math.round(light.rssi)} dBm` : ""}${light.playing ? "" : " · no show"}`;
  return (
    <div className={`lights-row${light.online ? "" : " offline"}`}>
      <div className="lights-row-name">
        <strong>String {light.string}</strong>
        <span>{detail}</span>
      </div>
      <div className="lights-row-end">
        <span className={`lights-bars${bars === 1 ? " weak" : ""}`} role="img" aria-label={light.online ? `${bars} of 4 bars` : "Offline"}>
          {[1, 2, 3, 4].map((i) => <span key={i} className={i <= bars ? "on" : ""} />)}
        </span>
        <button type="button" onClick={onRestart} disabled={restarting || !light.online}>
          {restarting ? <LoaderCircle className="spin" /> : "Restart"}
        </button>
      </div>
    </div>
  );
}
