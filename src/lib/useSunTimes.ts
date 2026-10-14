import { useState } from "react";
import { readJsonResponse } from "./http";
import { calculateSunTimes, type SunTimes, sunTimesFromNext } from "./nightDim";
import { usePolling } from "./usePolling";

type SunResponse = { configured: boolean; nextRising?: string | null; nextSetting?: string | null };
type HomeAssistantSun = { nextRising: Date; nextSetting: Date };

const SUN_REFRESH_MS = 30 * 60_000;

function parseSun(body: SunResponse): HomeAssistantSun | null {
  if (!body.configured || !body.nextRising || !body.nextSetting) return null;
  const nextRising = new Date(body.nextRising);
  const nextSetting = new Date(body.nextSetting);
  return Number.isNaN(nextRising.getTime()) || Number.isNaN(nextSetting.getTime()) ? null : { nextRising, nextSetting };
}

/**
 * Today's sunrise and sunset at `now`. Uses Home Assistant's sun.sun when it
 * answers and a local sunrise calculation when it doesn't.
 */
export function useSunTimes(now: Date): SunTimes {
  const [sun, setSun] = useState<HomeAssistantSun | null>(null);

  usePolling(async (signal) => {
    try {
      setSun(parseSun(await readJsonResponse<SunResponse>(await fetch("/api/sun", { signal }), "Sun times are unavailable")));
    } catch {
      setSun(null);
    }
  }, SUN_REFRESH_MS);

  return sun ? sunTimesFromNext(now, sun.nextRising, sun.nextSetting) : calculateSunTimes(now);
}
