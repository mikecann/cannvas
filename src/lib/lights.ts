import { useRef, useState } from "react";
import { errorText, readJsonResponse } from "./http";
import { usePolling } from "./usePolling";

/** One WLED string, as /api/lights reports it. */
export type LightString = {
  string: number;
  online: boolean;
  rssi?: number | null;
  /** Which access point it's on. The far strings stutter on "indoor". */
  via?: "extender" | "indoor" | null;
  /** True while effect-sim's frames are arriving. */
  playing?: boolean;
  version?: string | null;
};

export type LightsOnAt = "sunset" | "time";

/** When the plug comes on and goes off: Home Assistant's outside_lights.yaml. */
export type LightsSchedule = {
  onAt: LightsOnAt | null;
  /** "19:00", 24-hour. */
  onTime: string | null;
  offTime: string | null;
  /** The next sunset, ISO. */
  sunset: string | null;
};

/** What /api/lights reports. See LIGHTS_PLUG and LIGHT_STRINGS in deploy/cannvas-server. */
export type LightsStatus = {
  configured: boolean;
  on?: boolean | null;
  watts?: number | null;
  /** Empty while the plug is off: the boards have no power to answer. */
  strings?: LightString[];
  /** Null until outside_lights.yaml is installed in Home Assistant. */
  schedule?: LightsSchedule | null;
};

export type LightsState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; lights: LightsStatus };

const STALE_AFTER_MS = 60 * 1000;

/** Signal bars out of 4, from the board's RSSI. */
export function signalBars(rssi: number | null | undefined): number {
  if (rssi == null) return 0;
  if (rssi > -50) return 4;
  if (rssi > -62) return 3;
  if (rssi > -74) return 2;
  return 1;
}

export function useLights(intervalMs: number) {
  const [state, setState] = useState<LightsState>({ kind: "loading" });
  const lastSuccess = useRef(0);

  const refresh = usePolling(async (signal) => {
    try {
      const lights = await readJsonResponse<LightsStatus>(await fetch("/api/lights", { signal }), "The lights are unavailable");
      lastSuccess.current = Date.now();
      setState({ kind: "ready", lights });
    } catch (error) {
      if (signal.aborted) return;
      const message = errorText(error, "The lights are unavailable");
      setState((current) => current.kind === "ready" && Date.now() - lastSuccess.current < STALE_AFTER_MS
        ? current
        : { kind: "error", message });
    }
  }, intervalMs);

  return { state, refresh };
}
