import assert from "node:assert/strict";
import test from "node:test";
import { shuffledVideos } from "../src/lib/videoPlaylist.ts";

test("shuffles a playlist without changing the source list", () => {
  const source = ["one", "two", "three", "four"];
  const randomValues = [0, 0.75, 0.5];
  const shuffled = shuffledVideos(source, () => randomValues.shift());

  assert.deepEqual(source, ["one", "two", "three", "four"]);
  assert.deepEqual(shuffled, ["four", "two", "three", "one"]);
});

test("preserves every video exactly once", () => {
  const source = ["one", "two", "three", "four"];
  const shuffled = shuffledVideos(source, () => 0.25);

  assert.deepEqual([...shuffled].sort(), [...source].sort());
});
