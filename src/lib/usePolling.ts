import { useCallback, useEffect, useRef } from "react";
import { createPoller, DEFAULT_POLL_TIMEOUT_MS, type Poller, type PollTask, runWithTimeout } from "./poller";

type PollingOptions = {
  /** Pause polling without unmounting. Defaults to true. */
  enabled?: boolean;
  /** Run once straight away. Defaults to true. */
  immediate?: boolean;
  /** Give up on a run after this long. Defaults to 30 s. */
  timeoutMs?: number;
};

/**
 * Poll while the component is mounted. A run never overlaps the previous one,
 * and the returned function runs the task now (see `Poller.refresh`).
 * The latest `task` is always used, so it does not need to be memoised.
 * Pass the task's AbortSignal to fetch: it aborts on timeout and unmount.
 */
export function usePolling(
  task: PollTask,
  intervalMs: number,
  { enabled = true, immediate = true, timeoutMs = DEFAULT_POLL_TIMEOUT_MS }: PollingOptions = {},
) {
  const taskRef = useRef(task);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return;
    // Stopping aborts the old poller's run, so a new one never overlaps it.
    const poller = createPoller({ task: (signal) => taskRef.current(signal), intervalMs, immediate, timeoutMs });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, immediate, intervalMs, timeoutMs]);

  return useCallback(() => pollerRef.current?.refresh()
    ?? runWithTimeout((signal) => taskRef.current(signal), new AbortController(), timeoutMs).then(() => undefined, () => undefined),
  [timeoutMs]);
}
