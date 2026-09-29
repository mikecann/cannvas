import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw, WifiOff } from "lucide-react";

// Sammy Cam is its own app on Bruce, reachable on the home Wi-Fi and Tailscale.
// The kiosk is served over plain http, so it can show it directly.
const SAMMY_CAM_URL = "http://sammy.cam/";

type State = "checking" | "loading" | "ready" | "offline";

export function SammyCamApp() {
  const [state, setState] = useState<State>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // An iframe still "loads" an error page when Bruce is down, so ask first.
    // Sammy Cam's icon only decodes when its own server answers with a 200,
    // so Caddy's 502 while the app restarts also counts as offline.
    let active = true;
    const probe = new Image();
    const finish = (next: State) => {
      window.clearTimeout(timeout);
      if (active) setState(next);
    };
    const timeout = window.setTimeout(() => finish("offline"), 8000);
    probe.onload = () => finish("loading");
    probe.onerror = () => finish("offline");
    probe.src = `${SAMMY_CAM_URL}icon.svg?check=${Date.now()}`;
    return () => {
      active = false;
      window.clearTimeout(timeout);
      probe.src = "";
    };
  }, [attempt]);

  const retry = () => {
    setState("checking");
    setAttempt((value) => value + 1);
  };

  return (
    <section className="sammy-cam-app">
      {(state === "loading" || state === "ready") && (
        <iframe
          key={attempt}
          className={state === "ready" ? "sammy-cam-frame ready" : "sammy-cam-frame"}
          src={SAMMY_CAM_URL}
          title="Sammy Cam"
          allow="autoplay; fullscreen"
          onLoad={() => setState("ready")}
        />
      )}
      {(state === "checking" || state === "loading") && (
        <div className="loading-card" role="status">
          <LoaderCircle className="spin" />
          <strong>Opening Sammy Cam…</strong>
        </div>
      )}
      {state === "offline" && (
        <div className="loading-card sammy-cam-offline" role="alert">
          <WifiOff />
          <strong>Can't reach Sammy Cam</strong>
          <span>Bruce might be asleep or restarting. It usually comes back on its own.</span>
          <button className="button primary" onClick={retry}><RotateCcw />Try again</button>
        </div>
      )}
    </section>
  );
}
