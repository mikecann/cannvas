import { Lightbulb, LightbulbOff, Moon } from "lucide-react";
import { type PointerEvent, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { schedulePowerOffRecovery, SLEEP_RECOVERY_MS } from "../../lib/actionTiming";
import { type HomeAssistantAction, type HomeAssistantEntity, type HomeAssistantEntityStatus, isOn, isUnavailable } from "../../lib/homeAssistant";
import { errorText, readJsonResponse } from "../../lib/http";
import { isLightsTime } from "../../lib/nightDim";
import { useMinuteClock } from "../../lib/useMinuteClock";
import { usePolling } from "../../lib/usePolling";
import { useSunTimes } from "../../lib/useSunTimes";

// A Home Assistant light group holding the TV Lamp and the Tree Light, so new
// lamps can join it there without a Cannvas release.
const LIGHTS = "light.living_room_lights";
// A Home Assistant script: turns LIGHTS off, then shuts the Pi down and cuts
// the plug for the TV and Pi until the 06:00 automation turns it back on.
const SLEEP_TIME = "script.sleep_time";
const REFRESH_MS = 15_000;
// The TV Lamp's bulbs report back through Tuya's cloud, which takes a second
// or two. Checking sooner would briefly show the old state again.
const AFTER_ACTION_REFRESH_MS = 2_500;

async function runHomeAction(entityId: string, action: HomeAssistantAction, fallback: string) {
  const response = await fetch("/api/home-assistant/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityId, action }),
  });
  await readJsonResponse(response, fallback);
}

/** Big lights and sleep time buttons for the evening, from when the lights come on until sunrise. */
export function LightsHomeWidget({ onActivity }: { onActivity: () => void }) {
  const now = useMinuteClock();
  const times = useSunTimes(now);
  return isLightsTime(now, times) ? <LightsButtons onActivity={onActivity} /> : null;
}

function LightsButtons({ onActivity }: { onActivity: () => void }) {
  const [lights, setLights] = useState<HomeAssistantEntity | null>(null);
  const [pending, setPending] = useState(false);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [sleepPending, setSleepPending] = useState(false);
  const [sleepError, setSleepError] = useState("");

  const refresh = usePolling(async (signal) => {
    try {
      const response = await fetch(`/api/home-assistant/entity?id=${LIGHTS}`, { cache: "no-store", signal });
      const body = await readJsonResponse<HomeAssistantEntityStatus>(response, "The lights are unavailable");
      setLights(body.entity ?? null);
    } catch {
      // Keep the last reading through a brief Home Assistant or Wi-Fi blip.
    }
  }, REFRESH_MS);

  if (!lights) return null;
  const on = isOn(lights);
  const unavailable = isUnavailable(lights);

  const run = async (action: HomeAssistantAction) => {
    if (pending) return;
    setPending(true);
    setLights({ ...lights, state: action === "turn_on" ? "on" : "off" });
    try {
      await runHomeAction(LIGHTS, action, "The lights did not respond");
    } catch {
      // The refresh below puts the real state back.
    } finally {
      setPending(false);
      window.setTimeout(() => void refresh(), AFTER_ACTION_REFRESH_MS);
    }
  };

  const goToSleep = async () => {
    setSleepPending(true);
    setSleepError("");
    const recoveryTimer = schedulePowerOffRecovery({
      delayMs: SLEEP_RECOVERY_MS,
      recover: () => {
        setSleepPending(false);
        setSleepError("Cannvas is still on. Please try again.");
      },
    });
    try {
      await runHomeAction(SLEEP_TIME, "turn_on", "Home Assistant did not respond");
      setLights((current) => current && { ...current, state: "off" });
    } catch (error) {
      window.clearTimeout(recoveryTimer);
      setSleepPending(false);
      setSleepError(errorText(error, "Home Assistant did not respond"));
    }
  };

  // Keep these taps from waking the previous app, but restart the idle clock.
  const keepHome = (event: PointerEvent) => {
    event.stopPropagation();
    onActivity();
  };

  // Both lights buttons always work. "On" with only one lamp lit turns on the rest.
  return (
    <>
      <div className="lights-home-widget" role="group" aria-label={lights.name}>
        <button
          type="button"
          className={on ? "is-on is-current" : "is-on"}
          aria-pressed={on}
          disabled={unavailable}
          onPointerDown={keepHome}
          onClick={() => void run("turn_on")}
        >
          <Lightbulb aria-hidden="true" />
          Lights on
        </button>
        <button
          type="button"
          className={on || unavailable ? "is-off" : "is-off is-current"}
          aria-pressed={!on && !unavailable}
          disabled={unavailable}
          onPointerDown={keepHome}
          onClick={() => void run("turn_off")}
        >
          <LightbulbOff aria-hidden="true" />
          Lights off
        </button>
        <button
          type="button"
          className="is-sleep"
          onPointerDown={keepHome}
          onClick={() => {
            setSleepError("");
            setSleepOpen(true);
          }}
        >
          <Moon aria-hidden="true" />
          Sleep time
        </button>
      </div>

      {/* Inside the home screen, so a tap on the dialog must not wake the previous app either. */}
      <div className="lights-home-dialog" onPointerDown={keepHome}>
        <ConfirmDialog
          open={sleepOpen}
          title="Sleep time?"
          confirmLabel={sleepPending ? "Going to sleep…" : "Sleep time"}
          confirmDisabled={sleepPending}
          onCancel={() => {
            if (sleepPending) return;
            setSleepOpen(false);
            setSleepError("");
          }}
          onConfirm={() => void goToSleep()}
        >
          <p>This turns off the living room lights and Cannvas. Cannvas comes back on by itself at 6am.</p>
          {sleepError && <p className="dialog-error">{sleepError}</p>}
        </ConfirmDialog>
      </div>
    </>
  );
}
