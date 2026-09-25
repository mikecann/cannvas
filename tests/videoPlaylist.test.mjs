import assert from "node:assert/strict";
import test from "node:test";
import { keepPlayingFirst, parseVideoListing, shuffledVideos, videoRetryDelayMs } from "../src/lib/videoPlaylist.ts";

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

test("reads video files and sub-folders from a listing", () => {
  const html = '<ul><li><a href="../">..</a></li><li><a href="2024%20Trip/">2024 Trip/</a></li><li><a href="beach.mp4">beach.mp4</a></li><li><a href="notes.txt">notes.txt</a></li></ul>';
  assert.deepEqual(parseVideoListing(html, "/videos/", "http://127.0.0.1:4173"), {
    videos: ["/videos/beach.mp4"],
    folders: ["/videos/2024%20Trip/"],
  });
});

test("ignores links that escape the video root", () => {
  const html = '<a href="/assets/app.js">x</a><a href="../../secret.mp4">y</a>';
  assert.deepEqual(parseVideoListing(html, "/videos/", "http://127.0.0.1:4173"), { videos: [], folders: [] });
});

test("backs off between failed clips, up to a minute", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 20].map(videoRetryDelayMs),
    [0, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000],
  );
});

test("keeps the clip on screen at the front of a fresh list", () => {
  assert.deepEqual(keepPlayingFirst(["a", "b", "c"], "c"), ["c", "a", "b"]);
  assert.deepEqual(keepPlayingFirst(["a", "b"], "gone"), ["a", "b"]);
  assert.deepEqual(keepPlayingFirst(["a", "b"], undefined), ["a", "b"]);
});
