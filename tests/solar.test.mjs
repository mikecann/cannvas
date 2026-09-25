import assert from "node:assert/strict";
import test from "node:test";
import { isSolarFresh } from "../src/lib/solar.ts";

const now = Date.parse("2026-09-25T08:00:00+08:00");
const secondsAgo = (seconds) => new Date(now - seconds * 1000).toISOString();

test("treats recent Home Assistant reports as fresh", () => {
  assert.equal(isSolarFresh({ updatedAt: secondsAgo(5) }, now), true);
  assert.equal(isSolarFresh({ updatedAt: secondsAgo(119) }, now), true);
});

test("treats reports two minutes or older as stale", () => {
  assert.equal(isSolarFresh({ updatedAt: secondsAgo(120) }, now), false);
  assert.equal(isSolarFresh({ updatedAt: secondsAgo(3600) }, now), false);
});

test("treats missing or unreadable timestamps as stale", () => {
  assert.equal(isSolarFresh({ updatedAt: null }, now), false);
  assert.equal(isSolarFresh({}, now), false);
  assert.equal(isSolarFresh({ updatedAt: "not a date" }, now), false);
});
