import assert from "node:assert/strict";
import test from "node:test";
import { REPLAY_FADE_MS, replayPosition, replayTime, whiteboardReplay } from "../src/lib/whiteboardReplay.ts";

const pen = (count) => ({ id: "pen", color: "#000", width: 5, points: Array.from({ length: count }, (_, index) => ({ x: index / count, y: .5 })) });
const sticker = { id: "star", kind: "sticker", sticker: "⭐", color: "#000", width: 72, points: [{ x: .5, y: .5 }] };

test("keeps saved order, including legacy pens without a kind, and ignores empty strokes", () => {
  const first = pen(10);
  const last = pen(20);
  const replay = whiteboardReplay([first, sticker, pen(0), last]);
  assert.deepEqual(replay.entries.map(({ stroke }) => stroke), [first, sticker, last]);
  assert.deepEqual(replay.entries.map(({ start, end }) => [start, end]), [[0, 120], [120, 320], [320, 560]]);
  assert.equal(replay.duration, 560);
});

test("waits for the fade, eases the redraw, and holds the finished board from six seconds", () => {
  const replay = whiteboardReplay([pen(10000), sticker]);
  assert.equal(replay.duration, 5400);
  assert.equal(replayPosition(replay, 0), 0);
  assert.equal(replayPosition(replay, REPLAY_FADE_MS), 0);
  assert.ok(Math.abs(replayPosition(replay, REPLAY_FADE_MS + replay.duration / 2) - replay.total / 2) < 1e-8);
  assert.ok(replayPosition(replay, REPLAY_FADE_MS + replay.duration / 4) < replay.total / 4);
  assert.equal(replayPosition(replay, 6000), replay.total);
  assert.equal(replayPosition(replay, 10000), replay.total);
});

test("sticker timing matches its eased turn and crowded sticker boards fit the same budget", () => {
  const replay = whiteboardReplay([pen(100), sticker, pen(100)]);
  for (const { start, end } of replay.entries) {
    for (const position of [start, (start + end) / 2, end]) {
      assert.ok(Math.abs(replayPosition(replay, replayTime(replay, position)) - position) < 1e-8);
    }
  }
  const crowded = whiteboardReplay(Array.from({ length: 1000 }, () => sticker));
  assert.equal(crowded.duration, 5400);
  assert.equal(replayPosition(crowded, 6000), crowded.total);
});

test("an empty board has no replay work or invalid timing", () => {
  const replay = whiteboardReplay([pen(0)]);
  assert.deepEqual(replay.entries, []);
  assert.equal(replayPosition(replay, 1000), 0);
  assert.equal(replayTime(replay, 0), REPLAY_FADE_MS);
});
