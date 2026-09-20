import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserCompatibleCodec, isEligibleVideo } from "./bruce-media-sync.mjs";

test("keeps Chromium-compatible codecs direct", () => {
  assert.equal(isBrowserCompatibleCodec('( "H.264", "MPEG-4 AAC" )'), true);
  assert.equal(isBrowserCompatibleCodec('( VP9, Opus )'), true);
});

test("transcodes HEVC and unknown codecs", () => {
  assert.equal(isBrowserCompatibleCodec('( HEVC, "MPEG-4 AAC" )'), false);
  assert.equal(isBrowserCompatibleCodec('( HEVC, "H.264" )'), false);
  assert.equal(isBrowserCompatibleCodec('(null)'), false);
});

test("keeps portrait videos that are at least ten seconds long", () => {
  assert.equal(isEligibleVideo({ durationSeconds: 10, width: 1080, height: 1920 }), true);
  assert.equal(isEligibleVideo({ durationSeconds: 42.5, width: 720, height: 1280 }), true);
});

test("excludes short, landscape, square, and unknown videos", () => {
  assert.equal(isEligibleVideo({ durationSeconds: 9.999, width: 1080, height: 1920 }), false);
  assert.equal(isEligibleVideo({ durationSeconds: 20, width: 1920, height: 1080 }), false);
  assert.equal(isEligibleVideo({ durationSeconds: 20, width: 1080, height: 1080 }), false);
  assert.equal(isEligibleVideo({ durationSeconds: Number.NaN, width: 1080, height: 1920 }), false);
  assert.equal(isEligibleVideo({ durationSeconds: 20, width: Number.NaN, height: 1920 }), false);
});
