import assert from "node:assert/strict";
import test from "node:test";
import { drawStroke } from "../src/lib/drawing.ts";

function recordingContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    fillText: record("fillText"),
    save: record("save"),
    restore: record("restore"),
  };
}

const stroke = {
  id: "s",
  kind: "stroke",
  color: "#000",
  width: 5,
  points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
};

test("draws a whole stroke from its first point", () => {
  const context = recordingContext();
  drawStroke(context, stroke, 100, 100);
  assert.deepEqual(context.calls.filter(([name]) => name === "moveTo"), [["moveTo", 0, 0]]);
  assert.equal(context.calls.filter(([name]) => name === "lineTo").length, 3);
});

test("draws only the new part, joined to the last drawn point", () => {
  const context = recordingContext();
  drawStroke(context, stroke, 100, 100, 3);
  assert.deepEqual(context.calls.filter(([name]) => name === "moveTo"), [["moveTo", 100, 0]]);
  assert.deepEqual(context.calls.filter(([name]) => name === "lineTo"), [["lineTo", 100, 100]]);
});

test("draws nothing when every point is already drawn", () => {
  const context = recordingContext();
  drawStroke(context, stroke, 100, 100, 4);
  assert.deepEqual(context.calls, []);
});

test("a single tap still leaves a dot", () => {
  const context = recordingContext();
  drawStroke(context, { ...stroke, points: [{ x: 0.5, y: 0.5 }] }, 100, 100);
  assert.equal(context.calls.filter(([name]) => name === "lineTo").length, 1);
});
