import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROL_REFRESH_DELAY_MS,
  POWER_OFF_RECOVERY_MESSAGE,
  POWER_OFF_RECOVERY_MS,
  ROUTINE_ACTION_COOLDOWN_MS,
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
  assert.equal(timer.scheduled.delay, ROUTINE_ACTION_COOLDOWN_MS);
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
  assert.equal(timer.scheduled.delay, CONTROL_REFRESH_DELAY_MS);
  timer.scheduled.callback();
  assert.equal(refreshes, 1);
  assert.equal(releases, 0);
});

test("power-off recovery becomes available after fifteen seconds", () => {
  const timer = captureSchedule();
  let pending = true;
  let error = "";

  const timerId = schedulePowerOffRecovery({
    recover: () => {
      pending = false;
      error = POWER_OFF_RECOVERY_MESSAGE;
    },
    schedule: timer.schedule,
  });

  assert.equal(timerId, 42);
  assert.equal(timer.scheduled.delay, POWER_OFF_RECOVERY_MS);
  assert.equal(pending, true);
  assert.equal(error, "");

  timer.scheduled.callback();

  assert.equal(pending, false);
  assert.equal(error, "Cannvas is still online. Please try again.");
});
