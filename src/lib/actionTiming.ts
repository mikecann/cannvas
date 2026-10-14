export const ROUTINE_ACTION_COOLDOWN_MS = 1_000;
export const CONTROL_REFRESH_DELAY_MS = 500;
export const POWER_OFF_RECOVERY_MS = 15_000;
export const POWER_OFF_RECOVERY_MESSAGE = "Cannvas is still online. Please try again.";
// Sleep time goes through Home Assistant, which waits for the Pi's next poll
// (every 10 s) and cuts the plug within about two minutes even if the Pi never
// answers. Only offer a retry once all of that should be long over.
export const SLEEP_RECOVERY_MS = 3 * 60_000;

type Schedule = (callback: () => void, delay: number) => number;

type HomeActionRefreshOptions = {
  isRoutine: boolean;
  refresh: () => void | Promise<void>;
  releasePending: () => void;
  schedule?: Schedule;
};

/**
 * Schedule the status refresh after a Home Assistant action succeeds.
 *
 * Scenes and scripts need a short cooldown because their state does not
 * change in a way that can guard against a quick second tap. The boolean
 * return tells the caller whether pending cleanup has been deferred.
 */
export function scheduleHomeActionRefresh({
  isRoutine,
  refresh,
  releasePending,
  schedule = window.setTimeout,
}: HomeActionRefreshOptions) {
  if (isRoutine) {
    schedule(() => {
      void refresh();
      releasePending();
    }, ROUTINE_ACTION_COOLDOWN_MS);
    return true;
  }

  schedule(() => void refresh(), CONTROL_REFRESH_DELAY_MS);
  return false;
}

type PowerOffRecoveryOptions = {
  recover: () => void;
  delayMs?: number;
  schedule?: Schedule;
};

/** Keep the shutdown dialog recoverable if the accepted request never powers off Cannvas. */
export function schedulePowerOffRecovery({
  recover,
  delayMs = POWER_OFF_RECOVERY_MS,
  schedule = window.setTimeout,
}: PowerOffRecoveryOptions) {
  return schedule(recover, delayMs);
}
