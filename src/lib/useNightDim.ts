import { useEffect, useRef, useState } from "react";
import { nightDimLevel, SCREEN_WAKE_EVENT, TOUCH_WAKE_MS } from "./nightDim";
import { useMinuteClock } from "./useMinuteClock";
import { useSunTimes } from "./useSunTimes";

/**
 * The opacity of the evening dimming overlay, following today's sunset and
 * sunrise. A touch or the wake word brings back full brightness for a few minutes.
 */
export function useNightDim(): number {
  const now = useMinuteClock();
  const times = useSunTimes(now);
  const [awake, setAwake] = useState(false);
  const wakeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Only the timer restarts on each touch. State changes once per wake, so
    // drawing on the whiteboard doesn't re-render anything here.
    const wake = () => {
      window.clearTimeout(wakeTimer.current);
      wakeTimer.current = window.setTimeout(() => setAwake(false), TOUCH_WAKE_MS);
      setAwake(true);
    };
    window.addEventListener("pointerdown", wake, { passive: true, capture: true });
    window.addEventListener(SCREEN_WAKE_EVENT, wake);
    return () => {
      window.removeEventListener("pointerdown", wake, { capture: true });
      window.removeEventListener(SCREEN_WAKE_EVENT, wake);
      window.clearTimeout(wakeTimer.current);
    };
  }, []);

  if (awake) return 0;
  return nightDimLevel(now, times);
}
