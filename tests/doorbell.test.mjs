import assert from "node:assert/strict";
import test from "node:test";
import { checkDing, eventTime, frontDoorFrom, isBatteryLow } from "../src/lib/doorbell.ts";
import { isFilming, keyLightName } from "../src/lib/keyLights.ts";
import { whenLabel } from "../src/lib/dates.ts";

// Perth time, like the Pi.
process.env.TZ = "Australia/Perth";

const entity = (entityId, state, attributes = {}) => ({
  entityId,
  domain: entityId.split(".")[0],
  name: entityId,
  state,
  attributes,
});
const reading = (ding, ageSeconds) => ({ configured: true, ding, ageSeconds });

test("the first reading never rings, however recent", () => {
  assert.deepEqual(checkDing(undefined, reading("2026-10-21T01:00:00+00:00", 3)), { seen: "2026-10-21T01:00:00+00:00", ring: false });
  assert.deepEqual(checkDing(undefined, reading(null, null)), { seen: null, ring: false });
});

test("a new ring pops up", () => {
  assert.deepEqual(checkDing("2026-10-20T09:00:00+00:00", reading("2026-10-21T01:00:00+00:00", 1.5)), { seen: "2026-10-21T01:00:00+00:00", ring: true });
  // A doorbell that had never rung.
  assert.deepEqual(checkDing(null, reading("2026-10-21T01:00:00+00:00", 2)), { seen: "2026-10-21T01:00:00+00:00", ring: true });
});

test("the same ring only pops up once", () => {
  assert.equal(checkDing("2026-10-21T01:00:00+00:00", reading("2026-10-21T01:00:00+00:00", 5)).ring, false);
});

test("an old ring coming back after a Home Assistant restart stays quiet", () => {
  // Started while Home Assistant was down, then the Ring integration restored its last ring.
  const first = checkDing(undefined, reading(null, null));
  assert.deepEqual(checkDing(first.seen, reading("2026-10-20T09:23:45+00:00", 56_000)), { seen: "2026-10-20T09:23:45+00:00", ring: false });
  // Unavailable for a moment, then back with the same ring.
  const during = checkDing("2026-10-20T09:23:45+00:00", reading(null, null));
  assert.equal(during.seen, "2026-10-20T09:23:45+00:00");
  assert.equal(checkDing(during.seen, reading("2026-10-20T09:23:45+00:00", 60)).ring, false);
});

test("an older ring than the one seen is ignored", () => {
  assert.deepEqual(checkDing("2026-10-21T01:00:00+00:00", reading("2026-10-21T00:59:00+00:00", 5)), { seen: "2026-10-21T01:00:00+00:00", ring: false });
});

test("without Home Assistant's clock it falls back to this one", () => {
  const now = Date.parse("2026-10-21T01:00:05+00:00");
  assert.equal(checkDing(null, reading("2026-10-21T01:00:00+00:00", null), now).ring, true);
  assert.equal(checkDing(null, reading("2026-10-21T00:50:00+00:00", null), now).ring, false);
});

test("no Home Assistant, no doorbell", () => {
  assert.deepEqual(checkDing(undefined, { configured: false }), { seen: undefined, ring: false });
});

test("reads the front door from Home Assistant's states", () => {
  const door = frontDoorFrom([
    entity("camera.front_door_live_view", "idle"),
    entity("event.front_door_ding", "unknown"),
    entity("sensor.front_door_battery", "15", { unit_of_measurement: "%" }),
  ]);
  assert.equal(door.available, true);
  assert.equal(door.lastRing, null);
  assert.equal(door.battery, 15);
  assert.equal(isBatteryLow(door.battery), true);
  assert.equal(isBatteryLow(76), false);
  assert.equal(isBatteryLow(null), false);
  assert.equal(frontDoorFrom([entity("light.kitchen", "on")]), null);
  assert.equal(eventTime(entity("event.front_door_ding", "unavailable")), null);
});

test("says when things happened the way people do", () => {
  const now = new Date("2026-10-21T15:00:00+08:00");
  assert.equal(whenLabel(new Date("2026-10-21T08:05:00+08:00"), now), "8:05 am");
  assert.equal(whenLabel(new Date("2026-10-20T17:23:00+08:00"), now), "Yesterday 5:23 pm");
  assert.equal(whenLabel(new Date("2026-10-18T15:52:00+08:00"), now), "Sun 3:52 pm");
  assert.equal(whenLabel(new Date("2026-10-01T15:52:00+08:00"), now), "1 Oct");
});

test("filming while either Key Light is on", () => {
  assert.equal(isFilming([entity("light.a", "off"), entity("light.b", "on")]), true);
  assert.equal(isFilming([entity("light.a", "off"), null]), false);
  assert.equal(isFilming([entity("light.a", "unavailable")]), false);
  assert.equal(keyLightName({ name: "Elgato Key Light MK.2 E1A2" }), "Key Light E1A2");
});
