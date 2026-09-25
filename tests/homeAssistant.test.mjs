import assert from "node:assert/strict";
import test from "node:test";
import {
  controlAction,
  isGlanceSensor,
  isOn,
  isRoutine,
  isUnavailable,
  matchesFilter,
  stateLabel,
} from "../src/lib/homeAssistant.ts";

const entity = (entityId, state, attributes = {}) => ({
  entityId,
  domain: entityId.split(".")[0],
  name: entityId,
  state,
  attributes,
});

test("treats unavailable and unknown the same, in any case", () => {
  assert.equal(isUnavailable(entity("light.a", "Unavailable")), true);
  assert.equal(isUnavailable(entity("light.a", "unknown")), true);
  assert.equal(isUnavailable(entity("light.a", "off")), false);
});

test("scenes and scripts are routines that always turn on", () => {
  const scene = entity("scene.movie", "2026-09-25T10:00:00Z");
  assert.equal(isRoutine(scene), true);
  assert.equal(controlAction(scene), "turn_on");
  assert.equal(stateLabel(scene), "Run");
  assert.equal(matchesFilter(scene, "routines"), true);
});

test("switch-like controls toggle", () => {
  assert.equal(controlAction(entity("light.kitchen", "on")), "turn_off");
  assert.equal(controlAction(entity("fan.bedroom", "off")), "turn_on");
  assert.equal(isOn(entity("media_player.tv", "standby")), false);
  assert.equal(isOn(entity("media_player.tv", "playing")), true);
});

test("labels sensors in plain words", () => {
  assert.equal(stateLabel(entity("binary_sensor.front", "on", { device_class: "door" })), "Open");
  assert.equal(stateLabel(entity("binary_sensor.hall", "off", { device_class: "motion" })), "Clear");
  assert.equal(stateLabel(entity("sensor.phone", "54.4", { device_class: "battery", unit_of_measurement: "%" })), "54 %");
  assert.equal(stateLabel(entity("person.mike", "not_home")), "Away");
});

test("only shows useful sensors that are reporting", () => {
  assert.equal(isGlanceSensor(entity("sensor.temp", "21", { device_class: "temperature" })), true);
  assert.equal(isGlanceSensor(entity("sensor.temp", "unavailable", { device_class: "temperature" })), false);
  assert.equal(isGlanceSensor(entity("sensor.uptime", "12")), false);
  assert.equal(isGlanceSensor(entity("lock.front", "locked")), true);
});
