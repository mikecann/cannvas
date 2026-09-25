import { useRef, useState } from "react";
import { errorText, readJsonResponse } from "./http";
import { SOLAR_STALE_AFTER_MS, type SolarState, type SolarStatus } from "./solar";
import { usePolling } from "./usePolling";

// Without Home Assistant there is nothing to show, so only check back occasionally.
const UNCONFIGURED_INTERVAL_MS = 5 * 60 * 1000;

export function useSolar(intervalMs: number): SolarState {
  const [state, setState] = useState<SolarState>({ kind: "loading" });
  const lastSuccess = useRef(0);

  usePolling(async (signal) => {
    try {
      const solar = await readJsonResponse<SolarStatus>(await fetch("/api/solar", { signal }), "Solar data is unavailable");
      lastSuccess.current = Date.now();
      setState({ kind: "ready", solar });
      return solar.configured ? undefined : UNCONFIGURED_INTERVAL_MS;
    } catch (error) {
      if (signal.aborted) return;
      const message = errorText(error, "Solar data is unavailable");
      setState((current) => current.kind === "ready" && Date.now() - lastSuccess.current < SOLAR_STALE_AFTER_MS
        ? current
        : { kind: "error", message });
    }
  }, intervalMs);

  return state;
}
