import assert from "node:assert/strict";
import test from "node:test";
import { classifySwipe } from "../src/lib/swipe.ts";

test("reads a quick flat drag as a swipe in the direction the finger moved", () => {
  assert.equal(classifySwipe(-120, 10, 250), "left");
  assert.equal(classifySwipe(120, -10, 250), "right");
  assert.equal(classifySwipe(60, 0, 600), "right");
});

test("never reads a tap or a small wobble as a swipe", () => {
  assert.equal(classifySwipe(0, 0, 80), null);
  assert.equal(classifySwipe(8, 5, 120), null);
  assert.equal(classifySwipe(-59, 0, 200), null);
});

test("ignores slow drags and mostly vertical ones", () => {
  assert.equal(classifySwipe(200, 0, 900), null);
  assert.equal(classifySwipe(100, 80, 200), null);
  assert.equal(classifySwipe(-100, -200, 200), null);
});
