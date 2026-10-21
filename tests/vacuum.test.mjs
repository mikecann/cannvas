import assert from "node:assert/strict";
import test from "node:test";
import { consumableLabel, lowConsumables, vacuumActions, vacuumFrom, vacuumHeadline } from "../src/lib/vacuum.ts";

const entity = (entityId, state, attributes = {}) => ({
  entityId,
  domain: entityId.split(".")[0],
  name: entityId === "vacuum.roborock_q7_max" ? "Roborock Q7 Max" : entityId,
  state,
  attributes,
});
const hours = { unit_of_measurement: "h", device_class: "duration" };

// Shaped like the real Roborock Q7 Max entities in Home Assistant.
const roborock = (state = "docked", extra = []) => [
  entity("vacuum.roborock_q7_max", state),
  entity("sensor.roborock_q7_max_status", "charging"),
  entity("sensor.roborock_q7_max_vacuum_error", "none"),
  entity("sensor.roborock_q7_max_battery", "86", { unit_of_measurement: "%", device_class: "battery" }),
  entity("binary_sensor.roborock_q7_max_charging", "on"),
  entity("binary_sensor.roborock_q7_max_water_shortage", "off"),
  entity("sensor.roborock_q7_max_main_brush_time_left", "-242.461388888889", hours),
  entity("sensor.roborock_q7_max_side_brush_time_left", "64.2", hours),
  entity("sensor.roborock_q7_max_filter_time_left", "9.6", hours),
  entity("sensor.roborock_q7_max_sensor_time_left", "unavailable", hours),
  entity("sensor.roborock_q7_max_cleaning_time", "79.75", { unit_of_measurement: "min" }),
  entity("sensor.roborock_q7_max_cleaning_area", "88.5", { unit_of_measurement: "m²" }),
  entity("sensor.roborock_q7_max_last_clean_end", "2026-10-18T07:52:50+00:00", { device_class: "timestamp" }),
  entity("image.roborock_q7_max_map_0", "2026-10-21T00:55:12.363512+00:00"),
  entity("sensor.other_battery", "10", { device_class: "battery" }),
  ...extra,
];

test("reads the vacuum and the sensors named after it", () => {
  const vacuum = vacuumFrom(roborock());
  assert.equal(vacuum.name, "Roborock Q7 Max");
  assert.equal(vacuum.state, "docked");
  assert.equal(vacuum.error, null);
  assert.equal(vacuum.battery, 86);
  assert.equal(vacuum.charging, true);
  assert.equal(vacuum.cleaningMinutes, 80);
  assert.equal(vacuum.cleaningArea, 88.5);
  assert.equal(vacuum.lastClean.toISOString(), "2026-10-18T07:52:50.000Z");
  assert.equal(vacuum.mapVersion, "2026-10-21T00:55:12.363512+00:00");
  // The unavailable sensor reading is left out.
  assert.deepEqual(vacuum.consumables.map(({ key }) => key).sort(), ["filter", "main_brush", "side_brush"]);
});

test("no vacuum in Home Assistant means no tile", () => {
  assert.equal(vacuumFrom([entity("light.kitchen", "on")]), null);
});

test("describes each state in plain words", () => {
  const headline = (state, extra) => vacuumHeadline(vacuumFrom(roborock(state, extra)));
  assert.deepEqual(headline("docked"), { title: "Docked", detail: "Charging · 86%", tone: "ok" });
  assert.equal(headline("cleaning").title, "Cleaning");
  assert.equal(headline("cleaning").detail, "88.5 m² · 80 min so far");
  assert.equal(headline("returning").title, "Returning to dock");
  assert.equal(headline("paused").title, "Paused");
  assert.equal(headline("unavailable").tone, "offline");
});

test("an error shows the vacuum's own reason", () => {
  const entities = roborock("error").map((item) => item.entityId === "sensor.roborock_q7_max_vacuum_error"
    ? { ...item, state: "main_brush_jammed" }
    : item);
  assert.deepEqual(vacuumHeadline(vacuumFrom(entities)), { title: "Error", detail: "Main brush jammed", tone: "problem" });
});

test("a full battery on the dock reads as fully charged", () => {
  const entities = roborock().map((item) => item.entityId === "sensor.roborock_q7_max_battery" ? { ...item, state: "100" } : item);
  assert.equal(vacuumHeadline(vacuumFrom(entities)).detail, "Fully charged");
});

test("only offers buttons that make sense", () => {
  const actions = (state) => vacuumActions(vacuumFrom(roborock(state)));
  assert.deepEqual(actions("docked"), { start: true, pause: false, return_to_base: false });
  assert.deepEqual(actions("cleaning"), { start: false, pause: true, return_to_base: true });
  assert.deepEqual(actions("paused"), { start: true, pause: false, return_to_base: true });
  assert.deepEqual(actions("returning"), { start: true, pause: true, return_to_base: false });
  assert.deepEqual(actions("error"), { start: true, pause: false, return_to_base: true });
  assert.deepEqual(actions("unavailable"), { start: false, pause: false, return_to_base: false });
});

test("shows only consumables that are nearly worn out, most urgent first", () => {
  const low = lowConsumables(vacuumFrom(roborock()).consumables);
  assert.deepEqual(low.map(consumableLabel), [
    "Main brush: replace now (242 h overdue)",
    "Filter: 10 h left",
  ]);
});

test("labels consumables, including ones Cannvas doesn't know", () => {
  assert.equal(consumableLabel({ key: "sensor", hoursLeft: 0.2 }), "Sensors: clean now");
  assert.equal(consumableLabel({ key: "sensor", hoursLeft: -3.4 }), "Sensors: clean now (3 h overdue)");
  assert.equal(consumableLabel({ key: "dust_bag", hoursLeft: 4 }), "Dust bag: 4 h left");
});
