import assert from "node:assert/strict";
import test from "node:test";
import {
  scheduleHomeActionRefresh,
  schedulePowerOffRecovery,
} from "../src/lib/actionTiming.ts";

function captureSchedule() {
  let scheduled;
  return {
    schedule(callback, delay) {
      scheduled = { callback, delay };
      return 42;
    },
    get scheduled() {
      assert.ok(scheduled, "expected a callback to be scheduled");
      return scheduled;
    },
  };
}

test("routine actions stay pending for the cooldown before they refresh", () => {
  const timer = captureSchedule();
  let refreshes = 0;
  let releases = 0;

  const deferred = scheduleHomeActionRefresh({
    isRoutine: true,
    refresh: () => { refreshes += 1; },
    releasePending: () => { releases += 1; },
    schedule: timer.schedule,
  });

  assert.equal(deferred, true);
  // Pin the safety contract instead of mirroring the implementation constant.
  assert.equal(timer.scheduled.delay, 1_000);
  assert.equal(refreshes, 0);
  assert.equal(releases, 0);

  timer.scheduled.callback();

  assert.equal(refreshes, 1);
  assert.equal(releases, 1);
});

test("switch-like actions refresh sooner and let the caller release pending", () => {
  const timer = captureSchedule();
  let refreshes = 0;
  let releases = 0;

  const deferred = scheduleHomeActionRefresh({
    isRoutine: false,
    refresh: () => { refreshes += 1; },
    releasePending: () => { releases += 1; },
    schedule: timer.schedule,
  });

  assert.equal(deferred, false);
  assert.equal(timer.scheduled.delay, 500);
  timer.scheduled.callback();
  assert.equal(refreshes, 1);
  assert.equal(releases, 0);
});

test("power-off recovery becomes available after fifteen seconds", () => {
  const timer = captureSchedule();
  let recoveries = 0;

  const timerId = schedulePowerOffRecovery({
    recover: () => {
      recoveries += 1;
    },
    schedule: timer.schedule,
  });

  assert.equal(timerId, 42);
  // Fifteen seconds is the deliberate escape hatch from a stuck shutdown UI.
  assert.equal(timer.scheduled.delay, 15_000);
  assert.equal(recoveries, 0);

  timer.scheduled.callback();

  assert.equal(recoveries, 1);
});
