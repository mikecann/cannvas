import assert from "node:assert/strict";
import test from "node:test";
import { calculateSunTimes, DEEPEST_DIM, nightDimLevel, sunTimesFromNext } from "../src/lib/nightDim.ts";

// These tests use Perth time, like the Pi.
process.env.TZ = "Australia/Perth";
const at = (value) => new Date(`${value}+08:00`);
const minutes = (date) => date.getHours() * 60 + date.getMinutes();

test("calculates Busselton sunrise and sunset", () => {
  const spring = calculateSunTimes(at("2026-09-25T09:00:00"));
  // Published times for Busselton on 25 Sep 2026 are about 06:00 and 18:18.
  assert.ok(Math.abs(minutes(spring.sunrise) - (6 * 60 + 0)) <= 6, spring.sunrise.toString());
  assert.ok(Math.abs(minutes(spring.sunset) - (18 * 60 + 18)) <= 6, spring.sunset.toString());

  const winter = calculateSunTimes(at("2026-06-21T23:00:00"));
  assert.ok(minutes(winter.sunrise) > 7 * 60 && minutes(winter.sunrise) < 7 * 60 + 30, winter.sunrise.toString());
  assert.ok(minutes(winter.sunset) > 17 * 60 && minutes(winter.sunset) < 17 * 60 + 30, winter.sunset.toString());
});

test("uses Home Assistant's next times, shifted back once they are tomorrow's", () => {
  const now = at("2026-09-25T19:00:00");
  const sun = sunTimesFromNext(now, at("2026-09-26T05:59:00"), at("2026-09-26T18:19:00"));
  assert.equal(sun.sunrise.toISOString(), at("2026-09-25T05:59:00").toISOString());
  assert.equal(sun.sunset.toISOString(), at("2026-09-25T18:19:00").toISOString());

  const morning = at("2026-09-25T05:30:00");
  const early = sunTimesFromNext(morning, at("2026-09-25T06:00:00"), at("2026-09-25T18:18:00"));
  assert.equal(early.sunrise.toISOString(), at("2026-09-25T06:00:00").toISOString());
});

test("does not dim in daylight", () => {
  const sun = { sunrise: at("2026-09-25T06:00:00"), sunset: at("2026-09-25T18:18:00") };
  assert.equal(nightDimLevel(at("2026-09-25T07:00:00"), sun), 0);
  assert.equal(nightDimLevel(at("2026-09-25T18:17:00"), sun), 0);
});

test("dims gradually from sunset to the deepest level at 21:00", () => {
  const sun = { sunrise: at("2026-09-25T06:00:00"), sunset: at("2026-09-25T18:00:00") };
  assert.equal(nightDimLevel(at("2026-09-25T18:00:00"), sun), 0);
  assert.equal(nightDimLevel(at("2026-09-25T19:30:00"), sun), Math.round(DEEPEST_DIM * 500) / 1000);
  assert.equal(nightDimLevel(at("2026-09-25T21:00:00"), sun), DEEPEST_DIM);
  assert.equal(nightDimLevel(at("2026-09-25T21:10:00"), sun), DEEPEST_DIM);
});

test("stays dim before sunrise and undims at sunrise", () => {
  const sun = { sunrise: at("2026-06-22T07:17:00"), sunset: at("2026-06-22T17:20:00") };
  assert.equal(nightDimLevel(at("2026-06-22T07:05:00"), sun), DEEPEST_DIM);
  assert.equal(nightDimLevel(at("2026-06-22T07:17:00"), sun), 0);
});
