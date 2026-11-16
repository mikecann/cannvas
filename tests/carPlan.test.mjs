import assert from "node:assert/strict";
import test from "node:test";
import { chargePlan, chargeRate, formatClock, formatDuration } from "../src/lib/carPlan.ts";

// The tests run in Perth time, like the wall.
process.env.TZ = "Australia/Perth";
const at = (local) => new Date(`${local}+08:00`);
const charging = {
  configured: true, plugOn: true, powerKw: 1.78, mode: "solar",
  batteryPct: 37, batteryUpdatedAt: at("2026-11-16T20:44:00").toISOString(),
  batteryKw: 1.452, carCharging: true,
  settings: { chargeLimit: 100, dayMinimum: 50, overnightBelow: 30, overnightTarget: 60 },
};

test("reads the rate from the car's own battery power first", () => {
  assert.equal(chargeRate(charging).toFixed(2), "2.40");
  // Then its countdown to full: 63% in 25 h 51 m.
  assert.equal(chargeRate({ ...charging, batteryKw: null, fullInMinutes: 1551 }).toFixed(2), "2.44");
  // Then the plug.
  assert.equal(chargeRate({ ...charging, batteryKw: null, carCharging: false }).toFixed(2), "2.41");
  assert.equal(chargeRate({ ...charging, batteryKw: null, carCharging: false, powerKw: 0 }), null);
});

test("the daytime minimum stops at 9pm, short of the minimum", () => {
  const plan = chargePlan({ ...charging, minimumActive: true }, at("2026-11-16T20:54:00"), null);
  assert.equal(plan.target, 50);
  assert.equal(plan.cutShort, true);
  assert.equal(plan.endAt.getTime(), at("2026-11-16T21:00:00").getTime());
  assert.ok(plan.endPct > 37 && plan.endPct < 38);
});

test("an overnight top-up runs to its target, or stops at 7am", () => {
  const ten = at("2026-11-16T22:00:00");
  const low = { ...charging, overnightActive: true, batteryPct: 28, batteryUpdatedAt: ten.toISOString() };
  // 12% at 2.4% an hour is 5 h.
  const short = chargePlan({ ...low, settings: { ...charging.settings, overnightTarget: 40 } }, ten, null);
  assert.equal(short.cutShort, false);
  assert.equal(short.endPct, 40);
  assert.equal(Math.round((short.endAt - ten) / 60_000), 300);
  // 32% would take 13 h, so 7am cuts it short.
  const long = chargePlan(low, ten, null);
  assert.equal(long.cutShort, true);
  assert.equal(long.endAt.getTime(), at("2026-11-17T07:00:00").getTime());
  assert.equal(Math.round(long.endPct), 50);
});

test("a boost runs to its target whatever the time", () => {
  const plan = chargePlan({ ...charging, mode: "boost", boostTarget: 40 }, at("2026-11-16T20:44:00"), null);
  assert.equal(plan.cutShort, false);
  assert.equal(Math.round((plan.endAt - at("2026-11-16T20:44:00")) / 60_000), 75);
});

test("sun charging ends at sunset unless it reaches the limit first", () => {
  const noon = at("2026-11-17T12:00:00");
  const sunset = at("2026-11-17T19:10:00");
  const plan = chargePlan({ ...charging, batteryUpdatedAt: noon.toISOString() }, noon, sunset);
  assert.equal(plan.needsSun, true);
  assert.equal(plan.cutShort, true);
  assert.equal(plan.endAt.getTime(), sunset.getTime());
  assert.equal(chargePlan({ ...charging, batteryUpdatedAt: noon.toISOString(), settings: { chargeLimit: 50 } }, noon, sunset).cutShort, false);
});

test("no estimate for sun charging after sunset, as it's about to stop", () => {
  assert.equal(chargePlan(charging, at("2026-11-16T21:01:00"), at("2026-11-16T19:10:00")), null);
  assert.equal(chargePlan(charging, at("2026-11-16T21:01:00"), null), null);
});

test("moves the reading on since it last ticked, but never past the next whole %", () => {
  const plan = chargePlan({ ...charging, mode: "boost", boostTarget: 80 }, at("2026-11-16T21:44:00"), null);
  assert.equal(plan.nowPct, 37.99);
});

test("nothing to plan when it isn't drawing power", () => {
  assert.equal(chargePlan({ ...charging, powerKw: 0 }, at("2026-11-16T20:54:00"), null), null);
});

test("formats times and durations", () => {
  const now = at("2026-11-16T20:54:00");
  assert.equal(formatClock(at("2026-11-17T03:10:00"), now), "3:10am");
  assert.equal(formatClock(at("2026-11-17T13:10:00"), now), "Tue 1:10pm");
  assert.equal(formatDuration(75 * 60_000), "1h 15m");
  assert.equal(formatDuration(5 * 60_000), "5 min");
});
