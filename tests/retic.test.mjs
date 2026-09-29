import assert from "node:assert/strict";
import test from "node:test";
import { batteryLabel, dialBlocksWatering, minutesLeftLabel, nextRunLabel, scheduleLabel, skipReason, zoneMinutesLeft } from "../src/lib/retic.ts";

const now = Date.parse("2026-09-29T15:20:00+08:00");
const zone = (entityId, open) => ({ zone: 1, entityId, name: "Zone", state: open ? "open" : "closed", open });

test("counts down a Cannvas run from its end time, rounding up", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:26:30+08:00" }, controllerMinutesLeft: 15 };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_front_grass", true), now), 7);
});

test("never counts a finished run below zero", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:19:00+08:00" } };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_front_grass", true), now), 0);
});

test("falls back to the controller's countdown for runs started elsewhere", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:26:00+08:00" }, controllerMinutesLeft: 9 };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_back_grass_left", true), now), 9);
  assert.equal(zoneMinutesLeft({ configured: true }, zone("valve.retic_back_grass_left", true), now), null);
});

test("closed zones have no time left", () => {
  const status = { configured: true, run: { entityId: "valve.retic_front_grass", endsAt: "2026-09-29T15:26:00+08:00" } };
  assert.equal(zoneMinutesLeft(status, zone("valve.retic_front_grass", false), now), null);
});

test("labels time left", () => {
  assert.equal(minutesLeftLabel(null), "Watering now");
  assert.equal(minutesLeftLabel(1), "Less than a minute left");
  assert.equal(minutesLeftLabel(12), "12 min left");
});

test("only the RUN dial position allows watering", () => {
  assert.equal(dialBlocksWatering("Run"), false);
  assert.equal(dialBlocksWatering("Off"), true);
  assert.equal(dialBlocksWatering("Zone 3"), true);
  assert.equal(dialBlocksWatering(null), false);
});

test("labels the backup battery", () => {
  assert.equal(batteryLabel({ batteryLow: false, batteryVolts: 8.6 }), "OK");
  assert.equal(batteryLabel({ batteryLow: true, batteryVolts: 6.9 }), "Replace soon");
  assert.equal(batteryLabel({ batteryLow: null, batteryVolts: null }), "Unknown");
});

test("describes the schedule days and start time", () => {
  assert.equal(scheduleLabel([7, 3], "06:00"), "Wed and Sun at 6:00 am");
  assert.equal(scheduleLabel([1, 3, 5], "18:30"), "Mon, Wed and Fri at 6:30 pm");
  assert.equal(scheduleLabel([6], "12:05"), "Sat at 12:05 pm");
  assert.equal(scheduleLabel([], null), "No days");
});

test("labels the next run relative to today in Perth", () => {
  const tuesdayAfternoon = Date.parse("2026-09-29T16:00:00+08:00");
  assert.equal(nextRunLabel("2026-09-30T06:00:00+08:00", tuesdayAfternoon), "Tomorrow, 6:00 am");
  assert.equal(nextRunLabel("2026-09-29T18:00:00+08:00", tuesdayAfternoon), "Today, 6:00 pm");
  assert.equal(nextRunLabel("2026-10-04T06:00:00+08:00", tuesdayAfternoon), "Sun 4 Oct, 6:00 am");
  assert.equal(nextRunLabel(null, tuesdayAfternoon), "Not scheduled");
});

test("predicts a skip the same way Home Assistant decides it", () => {
  const schedule = { nextRun: null, days: [3, 7], start: "06:00", skipPastMm: 3, skipForecastMm: 5, running: false, lastResult: null, rainLast24h: 0.2, rainNext12h: 1.5 };
  assert.equal(skipReason({ enabled: true, rainDetected: false, schedule }), null);
  assert.equal(skipReason({ enabled: false, rainDetected: false, schedule }), "the retic is switched off");
  assert.equal(skipReason({ enabled: true, rainDetected: true, schedule }), "the rain sensor is wet");
  assert.equal(skipReason({ enabled: true, rainDetected: false, schedule: { ...schedule, rainLast24h: 3 } }), "3.0 mm of rain in the last 24 hours");
  assert.equal(skipReason({ enabled: true, rainDetected: false, schedule: { ...schedule, rainNext12h: 7.25 } }), "7.3 mm of rain forecast in the next 12 hours");
  assert.equal(skipReason({ enabled: null, rainDetected: false, schedule }), "the retic switch can't be read");
  // Missing limits fall back to Home Assistant's 3 mm and 5 mm.
  assert.equal(skipReason({ enabled: true, rainDetected: false, schedule: { ...schedule, skipPastMm: null, rainLast24h: 3.5 } }), "3.5 mm of rain in the last 24 hours");
  assert.equal(skipReason({ enabled: true, rainDetected: false, schedule: { ...schedule, skipForecastMm: null, rainNext12h: 5 } }), "5.0 mm of rain forecast in the next 12 hours");
  // Missing weather means it waters, like Home Assistant.
  assert.equal(skipReason({ enabled: true, rainDetected: null, schedule: { ...schedule, rainLast24h: null, rainNext12h: null } }), null);
});
