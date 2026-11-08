import { useState } from "react";
import { readJsonResponse } from "./http";
import type { HourlyRain } from "./reticRain";
import { usePolling } from "./usePolling";

// The Pi caches the forecast for 15 minutes, so polling faster gains nothing.
const RAIN_INTERVAL_MS = 15 * 60 * 1000;

/** Hourly rain for the last three weeks and the next few days, or null until it loads. */
export function useReticRain() {
  const [rain, setRain] = useState<HourlyRain | null>(null);

  usePolling(async (signal) => {
    try {
      const body = await readJsonResponse<{ configured: boolean } & Partial<HourlyRain>>(await fetch("/api/retic/rain", { signal }), "Couldn't load the rain");
      const { time, precipitation } = body;
      if (Array.isArray(time) && Array.isArray(precipitation) && time.length === precipitation.length) setRain({ time, precipitation });
    } catch {
      // Keep the last good forecast. The graph and outlook are extras, and the
      // schedule's own rain numbers still show in the status.
    }
  }, RAIN_INTERVAL_MS);

  return rain;
}
