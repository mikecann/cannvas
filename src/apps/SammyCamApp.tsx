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
    // An iframe still "loads" Chromium's error page when Bruce is down, so ask
    // first. no-cors can't read the reply but only rejects when nothing answers.
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    fetch(SAMMY_CAM_URL, { mode: "no-cors", cache: "no-store", signal: controller.signal })
      .then(() => active && setState("loading"))
      .catch(() => active && setState("offline"))
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
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
