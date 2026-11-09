import { useState } from "react";
import { readJsonResponse } from "./http";
import type { HourlyRain } from "./reticRain";
import { usePolling } from "./usePolling";

// The Pi caches the forecast for 15 minutes, so polling faster gains nothing.
const RAIN_INTERVAL_MS = 15 * 60 * 1000;
// After this long without a fresh forecast, stop predicting from the old one.
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Hourly rain for the last three weeks and the next few days, or null when there's no recent forecast. */
export function useReticRain() {
  const [latest, setLatest] = useState<{ rain: HourlyRain; at: number } | null>(null);

  usePolling(async (signal) => {
    try {
      const body = await readJsonResponse<{ configured: boolean } & Partial<HourlyRain>>(await fetch("/api/retic/rain", { signal }), "Couldn't load the rain");
      const { time, precipitation } = body;
      if (Array.isArray(time) && Array.isArray(precipitation) && time.length === precipitation.length) setLatest({ rain: { time, precipitation }, at: Date.now() });
    } catch {
      // Keep the last forecast until it goes stale. The graph and the
      // prediction are extras on top of the controls.
    }
  }, RAIN_INTERVAL_MS);

  return latest && Date.now() - latest.at < STALE_AFTER_MS ? latest.rain : null;
}
