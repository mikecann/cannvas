import { usePolling } from "./usePolling";

const HEARTBEAT_MS = 30_000;

/**
 * Tell the Pi's server the page is alive. The kiosk watchdog restarts
 * Chromium when these stop for three minutes, so this lives in the app shell:
 * if React stops rendering, the pings stop too.
 */
export function useHeartbeat() {
  usePolling(async (signal) => {
    try {
      await fetch("/api/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        signal,
      });
    } catch {
      // The server being down is the watchdog's business, not the page's.
    }
  }, HEARTBEAT_MS);
}
