/**
 * Runs a task now and then again after each run finishes, so a slow request
 * can never overlap the next one.
 *
 * The task may return a number to choose the delay before the next run, for
 * example a longer wait when there is nothing to show yet. A thrown error
 * keeps the normal interval. Handle and report errors inside the task.
 */
export type PollTask = () => Promise<number | void> | number | void;

type Schedule = (callback: () => void, delay: number) => unknown;
type Cancel = (timer: unknown) => void;

export type PollerOptions = {
  task: PollTask;
  intervalMs: number;
  /** Run as soon as the poller starts. Defaults to true. */
  immediate?: boolean;
  schedule?: Schedule;
  cancel?: Cancel;
};

export type Poller = {
  start: () => void;
  stop: () => void;
  /**
   * Run now. If a run is already going, one more run follows it and the
   * promise settles after that, so the caller always sees fresh data.
   */
  refresh: () => Promise<void>;
};

export function createPoller({
  task,
  intervalMs,
  immediate = true,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: PollerOptions): Poller {
  let active = false;
  let timer: unknown;
  let running: Promise<void> | null = null;
  let rerun = false;

  const clearTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };

  const loop = async () => {
    let delay = intervalMs;
    do {
      rerun = false;
      try {
        const next = await task();
        delay = typeof next === "number" && Number.isFinite(next) && next >= 0 ? next : intervalMs;
      } catch {
        delay = intervalMs;
      }
    } while (rerun && active);
    running = null;
    if (active) {
      clearTimer();
      timer = schedule(tick, delay);
    }
  };

  const tick = () => {
    timer = undefined;
    if (!running) running = loop();
  };

  return {
    start() {
      if (active) return;
      active = true;
      if (immediate) tick();
      else timer = schedule(tick, intervalMs);
    },
    stop() {
      active = false;
      rerun = false;
      clearTimer();
    },
    refresh() {
      if (!active) return Promise.resolve(task()).then(() => undefined, () => undefined);
      clearTimer();
      if (running) {
        rerun = true;
        return running;
      }
      running = loop();
      return running;
    },
  };
}
