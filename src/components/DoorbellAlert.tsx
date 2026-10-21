import { BellRing } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clockTime } from "../lib/dates";
import { checkDing, type DingReading } from "../lib/doorbell";
import { readJsonResponse } from "../lib/http";
import { usePolling } from "../lib/usePolling";
import { DoorbellSnapshot } from "./DoorbellSnapshot";

// The Pi asks Home Assistant on each poll, so a ring shows within a couple of seconds.
const DING_POLL_MS = 1_500;
const NOT_CONNECTED_POLL_MS = 60_000;
const SHOW_FOR_MS = 60_000;

/** Pops up over whatever is on screen when someone rings the front doorbell. */
export function DoorbellAlert() {
  const seen = useRef<string | null | undefined>(undefined);
  const [rang, setRang] = useState<Date | null>(null);

  usePolling(async (signal) => {
    try {
      const response = await fetch("/api/doorbell/ding", { cache: "no-store", signal });
      const reading = await readJsonResponse<DingReading>(response, "The doorbell is unavailable");
      const result = checkDing(seen.current, reading);
      seen.current = result.seen;
      if (result.ring && reading.ding) setRang(new Date(reading.ding));
      if (!reading.configured) return NOT_CONNECTED_POLL_MS;
    } catch {
      // Keep listening through a brief Home Assistant or Wi-Fi blip.
    }
  }, DING_POLL_MS, { timeoutMs: 6_000 });

  useEffect(() => {
    if (!rang) return;
    // Another ring sets a new time, which starts the minute again.
    const timer = window.setTimeout(() => setRang(null), SHOW_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [rang]);

  if (!rang) return null;

  return (
    <div
      className="doorbell-alert"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="doorbell-alert-title"
      // A tap closes it without waking the home screen into another app.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => setRang(null)}
    >
      <section className="doorbell-alert-card">
        <header>
          <span className="doorbell-alert-icon"><BellRing aria-hidden="true" /></span>
          <div>
            <h2 id="doorbell-alert-title">Someone's at the front door</h2>
            <p>Rang at {clockTime(rang)}</p>
          </div>
        </header>
        <DoorbellSnapshot refreshMs={2_000} className="doorbell-alert-picture" />
        <button type="button" className="button primary">OK</button>
        <small>Tap anywhere to close</small>
      </section>
    </div>
  );
}
