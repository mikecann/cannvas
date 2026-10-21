import { CameraOff, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePolling } from "../lib/usePolling";

// Ring only gives Home Assistant pictures with a Ring Protect plan, so after a
// failure there's no point asking every few seconds.
const RETRY_AFTER_FAILURE_MS = 30_000;

/** The front door camera's latest picture, through the Pi, refreshed every `refreshMs`. */
export function DoorbellSnapshot({ refreshMs, className }: { refreshMs: number; className?: string }) {
  const [picture, setPicture] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = useRef<string | null>(null);

  usePolling(async (signal) => {
    try {
      const response = await fetch(`/api/doorbell/snapshot?t=${Date.now()}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("The doorbell has no picture");
      const url = URL.createObjectURL(await response.blob());
      if (shown.current) URL.revokeObjectURL(shown.current);
      shown.current = url;
      setPicture(url);
      setFailed(false);
    } catch {
      if (signal.aborted) return;
      setFailed(true);
      return RETRY_AFTER_FAILURE_MS;
    }
  }, refreshMs, { timeoutMs: 15_000 });

  useEffect(() => () => {
    if (shown.current) URL.revokeObjectURL(shown.current);
  }, []);

  return (
    <div className={["doorbell-snapshot", className, failed && "is-failed"].filter(Boolean).join(" ")}>
      {/* An old picture would be misleading here, so a failed refresh hides it. */}
      {picture && !failed
        ? <img src={picture} alt="The front door camera" />
        : (
          <div className="doorbell-snapshot-empty">
            {failed ? <CameraOff aria-hidden="true" /> : <LoaderCircle className="spin" aria-hidden="true" />}
            <span>{failed ? "No picture from the doorbell right now" : "Getting the picture…"}</span>
          </div>
        )}
    </div>
  );
}
