import assert from "node:assert/strict";
import test from "node:test";
import { isSolarFresh, spareSolarKw } from "../src/lib/solar.ts";

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

test("reports spare solar only when the estimate is clearly higher", () => {
  assert.equal(spareSolarKw(1.2, 5.4), 4.2);
  // Exactly on the 300 W threshold.
  assert.equal(spareSolarKw(1.7, 2), 0.3);
  // Within the model's noise.
  assert.equal(spareSolarKw(2.19, 2.3), null);
  // Actual above the estimate happens too.
  assert.equal(spareSolarKw(2.19, 1.85), null);
  assert.equal(spareSolarKw(null, 5), null);
  assert.equal(spareSolarKw(1, null), null);
});
