import assert from "node:assert/strict";
import test from "node:test";
import { formatClockTime, shiftClockTime } from "../src/lib/clockTime.ts";

test("clock times read like the wall", () => {
  assert.equal(formatClockTime("19:00"), "7:00pm");
  assert.equal(formatClockTime("00:15"), "12:15am");
  assert.equal(formatClockTime("12:30"), "12:30pm");
});

test("times step to the next quarter hour and wrap round midnight", () => {
  assert.equal(shiftClockTime("22:00", 15, 1), "22:15");
  assert.equal(shiftClockTime("19:07", 15, 1), "19:15");
  assert.equal(shiftClockTime("19:07", 15, -1), "19:00");
  assert.equal(shiftClockTime("23:45", 15, 1), "00:00");
  assert.equal(shiftClockTime("00:00", 15, -1), "23:45");
});
