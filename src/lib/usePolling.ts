import { useCallback, useEffect, useRef } from "react";
import { createPoller, type Poller, type PollTask } from "./poller";

type PollingOptions = {
  /** Pause polling without unmounting. Defaults to true. */
  enabled?: boolean;
  /** Run once straight away. Defaults to true. */
  immediate?: boolean;
};

/**
 * Poll while the component is mounted. A run never overlaps the previous one,
 * and the returned function runs the task now (see `Poller.refresh`).
 * The latest `task` is always used, so it does not need to be memoised.
 */
export function usePolling(task: PollTask, intervalMs: number, { enabled = true, immediate = true }: PollingOptions = {}) {
  const taskRef = useRef(task);
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    if (!enabled) return;
    const poller = createPoller({ task: () => taskRef.current(), intervalMs, immediate });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, immediate, intervalMs]);

  return useCallback(
    () => pollerRef.current?.refresh() ?? Promise.resolve(taskRef.current()).then(() => undefined, () => undefined),
    [],
  );
}
