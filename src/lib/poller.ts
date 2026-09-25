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
export function runWithTimeout(
  task: PollTask,
  controller: AbortController,
  timeoutMs: number,
  onStarted?: (settled: Promise<unknown>) => void,
): Promise<number | void> {
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
    const work = Promise.resolve().then(() => task(controller.signal));
    onStarted?.(work.then(() => undefined, () => undefined));
    work
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

  // A timed-out task that ignored its signal may still be running. Skip runs
  // until it settles, so requests still never overlap, but only for a while:
  // a task that never settles must not stop polling for good.
  let lingering: { settled: Promise<unknown>; since: number } | null = null;

  const loop = async () => {
    let delay = intervalMs;
    do {
      rerun = false;
      if (lingering && Date.now() - lingering.since < timeoutMs * 3) {
        delay = intervalMs;
        continue;
      }
      lingering = null;
      const runController = new AbortController();
      controller = runController;
      let settled: Promise<unknown> | undefined;
      try {
        const next = await runWithTimeout(task, runController, timeoutMs, (work) => { settled = work; });
        delay = typeof next === "number" && Number.isFinite(next) && next >= 0 ? next : intervalMs;
      } catch {
        delay = intervalMs;
        if (runController.signal.aborted && settled) {
          const entry = { settled, since: Date.now() };
          lingering = entry;
          void settled.then(() => {
            if (lingering === entry) lingering = null;
          });
        }
      }
      controller = null;
    } while (rerun && active);
    return delay;
  };

  // `running` is cleared in a later callback, never inside loop(), because a
  // loop that skips its run finishes before loop() even returns.
  const startLoop = () => {
    const run: Promise<void> = loop().then((delay) => {
      if (running === run) running = null;
      if (active) {
        clearTimer();
        timer = schedule(tick, delay);
      }
    });
    running = run;
    return run;
  };

  const tick = () => {
    timer = undefined;
    if (!running) startLoop();
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
      return startLoop();
    },
  };
}
