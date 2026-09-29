import { useRef, useState } from "react";
import { errorText, readJsonResponse } from "./http";
import { RETIC_STALE_AFTER_MS, type ReticState, type ReticStatus } from "./retic";
import { usePolling } from "./usePolling";

// Without Home Assistant there is nothing to show, so only check back occasionally.
const UNCONFIGURED_INTERVAL_MS = 5 * 60 * 1000;

export function useRetic(intervalMs: number) {
  const [state, setState] = useState<ReticState>({ kind: "loading" });
  const lastSuccess = useRef(0);

  const refresh = usePolling(async (signal) => {
    try {
      const retic = await readJsonResponse<ReticStatus>(await fetch("/api/retic", { signal }), "The retic controller is unavailable");
      lastSuccess.current = Date.now();
      setState({ kind: "ready", retic });
      return retic.configured ? undefined : UNCONFIGURED_INTERVAL_MS;
    } catch (error) {
      if (signal.aborted) return;
      const message = errorText(error, "The retic controller is unavailable");
      setState((current) => current.kind === "ready" && Date.now() - lastSuccess.current < RETIC_STALE_AFTER_MS
        ? current
        : { kind: "error", message });
    }
  }, intervalMs);

  return { state, refresh };
}
