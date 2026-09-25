/**
 * Runs a task now and then again after each run finishes, so a slow request
 * can never overlap the next one.
 *
 * The task may return a number to choose the delay before the next run, for
 * example a longer wait when there is nothing to show yet. A thrown error
 * keeps the normal interval. Handle and report errors inside the task.
 *
 * Each run gets an AbortSignal. It aborts when the run takes longer than
 * `timeoutMs` or the poller stops, so pass it to fetch: a hung connection
 * then can't stall polling, and a late answer can't land after unmount.
 */
export type PollTask = (signal: AbortSignal) => Promise<number | void> | number | void;

type Schedule = (callback: () => void, delay: number) => unknown;
type Cancel = (timer: unknown) => void;

export const DEFAULT_POLL_TIMEOUT_MS = 30_000;

export type PollerOptions = {
  task: PollTask;
  intervalMs: number;
  /** Run as soon as the poller starts. Defaults to true. */
  immediate?: boolean;
  /** Give up on a run after this long and carry on. Defaults to 30 s. */
  timeoutMs?: number;
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

/** Runs one task, rejecting (and aborting it) if it takes longer than timeoutMs. */
export function runWithTimeout(task: PollTask, controller: AbortController, timeoutMs: number): Promise<number | void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort(new Error("Timed out"));
    }, timeoutMs);
    // A timeout or stop settles the run even if the task ignores the signal.
    controller.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(controller.signal.reason);
    }, { once: true });
    // Through a promise, so a task that throws synchronously is handled too.
    Promise.resolve()
      .then(() => task(controller.signal))
      .then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error: unknown) => { clearTimeout(timer); reject(error); },
      );
  });
}

export function createPoller({
  task,
  intervalMs,
  immediate = true,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: PollerOptions): Poller {
  let active = false;
  let timer: unknown;
  let running: Promise<void> | null = null;
  let rerun = false;
  let controller: AbortController | null = null;

  const clearTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };

  const loop = async () => {
    let delay = intervalMs;
    do {
      rerun = false;
      controller = new AbortController();
      try {
        const next = await runWithTimeout(task, controller, timeoutMs);
        delay = typeof next === "number" && Number.isFinite(next) && next >= 0 ? next : intervalMs;
      } catch {
        delay = intervalMs;
      }
      controller = null;
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
      controller?.abort(new Error("Stopped"));
    },
    refresh() {
      if (!active) {
        return runWithTimeout(task, new AbortController(), timeoutMs).then(() => undefined, () => undefined);
      }
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
