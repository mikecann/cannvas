import { useEffect, useRef, useState } from "react";
import { usePolling } from "../lib/usePolling";

// Ring only gives Home Assistant pictures with a Ring Protect plan. Without
// one every request fails, so after a failure only check now and then.
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

/**
 * The front door camera's latest picture, through the Pi, refreshed every
 * `refreshMs`. Shows nothing at all until a picture actually loads.
 */
export function DoorbellSnapshot({ refreshMs, className }: { refreshMs: number; className?: string }) {
  const [picture, setPicture] = useState<string | null>(null);
  const shown = useRef<string | null>(null);

  const show = (url: string | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = url;
    setPicture(url);
  };

  usePolling(async (signal) => {
    try {
      const response = await fetch(`/api/doorbell/snapshot?t=${Date.now()}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("The doorbell has no picture");
      show(URL.createObjectURL(await response.blob()));
    } catch {
      if (signal.aborted) return;
      // An old picture would be misleading, so a failed refresh hides it.
      show(null);
      return RETRY_AFTER_FAILURE_MS;
    }
  }, refreshMs, { timeoutMs: 15_000 });

  useEffect(() => () => {
    if (shown.current) URL.revokeObjectURL(shown.current);
  }, []);

  if (!picture) return null;
  return (
    <div className={className ? `doorbell-snapshot ${className}` : "doorbell-snapshot"}>
      <img src={picture} alt="The front door camera" />
    </div>
  );
}
