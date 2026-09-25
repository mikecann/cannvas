import { useEffect, useRef, useState } from "react";
import { readJsonResponse } from "./http";
import { calculateSunTimes, nightDimLevel, type SunTimes, sunTimesFromNext, TOUCH_WAKE_MS } from "./nightDim";
import { useMinuteClock } from "./useMinuteClock";
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
 * The opacity of the evening dimming overlay. Uses Home Assistant's sun.sun
 * when it answers and a local sunrise calculation when it doesn't. A touch
 * brings back full brightness for a few minutes.
 */
export function useNightDim(): number {
  const now = useMinuteClock();
  const [sun, setSun] = useState<HomeAssistantSun | null>(null);
  const [awake, setAwake] = useState(false);
  const wakeTimer = useRef<number | undefined>(undefined);

  usePolling(async () => {
    try {
      setSun(parseSun(await readJsonResponse<SunResponse>(await fetch("/api/sun"), "Sun times are unavailable")));
    } catch {
      setSun(null);
    }
  }, SUN_REFRESH_MS);

  useEffect(() => {
    // Only the timer restarts on each touch. State changes once per wake, so
    // drawing on the whiteboard doesn't re-render anything here.
    const wake = () => {
      window.clearTimeout(wakeTimer.current);
      wakeTimer.current = window.setTimeout(() => setAwake(false), TOUCH_WAKE_MS);
      setAwake(true);
    };
    window.addEventListener("pointerdown", wake, { passive: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", wake, { capture: true });
      window.clearTimeout(wakeTimer.current);
    };
  }, []);

  if (awake) return 0;
  const times: SunTimes = sun ? sunTimesFromNext(now, sun.nextRising, sun.nextSetting) : calculateSunTimes(now);
  return nightDimLevel(now, times);
}
