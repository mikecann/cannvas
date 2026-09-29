import assert from "node:assert/strict";
import test from "node:test";
import { batteryLabel, dialBlocksWatering, minutesLeftLabel, zoneMinutesLeft } from "../src/lib/retic.ts";

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
