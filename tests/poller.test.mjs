import assert from "node:assert/strict";
import test from "node:test";
import { createPoller } from "../src/lib/poller.ts";

function manualClock() {
  const timers = [];
  return {
    schedule(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(timer) {
      timer.cancelled = true;
    },
    pending() {
      return timers.filter((timer) => !timer.cancelled && !timer.fired);
    },
    fire() {
      const [timer] = this.pending();
      assert.ok(timer, "expected a scheduled run");
      timer.fired = true;
      timer.callback();
      return timer;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("runs at once, then schedules the next run after the last one finishes", async () => {
  const clock = manualClock();
  let runs = 0;
  const poller = createPoller({ task: () => { runs += 1; }, intervalMs: 3000, ...clock });
  poller.start();
  assert.equal(runs, 1);
  await settle();
  assert.equal(clock.pending().length, 1);
  assert.equal(clock.pending()[0].delay, 3000);
  clock.fire();
  await settle();
  assert.equal(runs, 2);
  poller.stop();
  assert.equal(clock.pending().length, 0);
});

test("never overlaps a slow run", async () => {
  const clock = manualClock();
  const slow = deferred();
  let started = 0;
  const poller = createPoller({ task: () => { started += 1; return slow.promise; }, intervalMs: 1000, ...clock });
  poller.start();
  await settle();
  // Nothing is scheduled while the first run is still going.
  assert.equal(clock.pending().length, 0);
  assert.equal(started, 1);
  slow.resolve();
  await settle();
  assert.equal(clock.pending().length, 1);
  poller.stop();
});

test("a refresh during a run queues exactly one more run", async () => {
  const clock = manualClock();
  const gates = [deferred(), deferred()];
  let started = 0;
  const poller = createPoller({ task: () => gates[started++]?.promise, intervalMs: 1000, ...clock });
  poller.start();
  const first = poller.refresh();
  const second = poller.refresh();
  assert.equal(started, 1);
  gates[0].resolve();
  await settle();
  assert.equal(started, 2);
  gates[1].resolve();
  await Promise.all([first, second]);
  assert.equal(started, 2);
  poller.stop();
});

test("the task can choose the next delay, and errors keep polling", async () => {
  const clock = manualClock();
  const results = [60_000, new Error("offline")];
  const poller = createPoller({
    task: () => {
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    intervalMs: 5000,
    ...clock,
  });
  poller.start();
  await settle();
  assert.equal(clock.fire().delay, 60_000);
  await settle();
  assert.equal(clock.pending()[0].delay, 5000);
  poller.stop();
});

test("stopping during a run does not schedule another", async () => {
  const clock = manualClock();
  const gate = deferred();
  const poller = createPoller({ task: () => gate.promise, intervalMs: 1000, ...clock });
  poller.start();
  poller.stop();
  gate.resolve();
  await settle();
  assert.equal(clock.pending().length, 0);
});
