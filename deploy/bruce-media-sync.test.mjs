import assert from "node:assert/strict";
import test from "node:test";
import {
  conversionFailureBackoffMs,
  isBrowserCompatibleCodec,
  isEligibleVideo,
  isGeneratedPartialName,
  isScreenRecording,
} from "./bruce-media-sync.mjs";

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

test("backs off progressively when conversions fail repeatedly", () => {
  assert.equal(conversionFailureBackoffMs(0), 0);
  assert.equal(conversionFailureBackoffMs(1), 60_000);
  assert.equal(conversionFailureBackoffMs(2), 5 * 60_000);
  assert.equal(conversionFailureBackoffMs(3), 15 * 60_000);
  assert.equal(conversionFailureBackoffMs(4), 30 * 60_000);
  assert.equal(conversionFailureBackoffMs(50), 30 * 60_000);
});

test("recognises only generated conversion partials", () => {
  assert.equal(isGeneratedPartialName("IMG_1234.MOV.m4v.partial-27185.m4v"), true);
  assert.equal(isGeneratedPartialName("family.m4v"), false);
  assert.equal(isGeneratedPartialName("family.partial-edit.m4v"), false);
});

test("recognises iPhone and Mac screen recordings by name", () => {
  assert.equal(isScreenRecording("/archive/2022/12/RPReplay_Final1671689835.mp4"), true);
  assert.equal(isScreenRecording("/archive/2026/01/ScreenRecording_01-28-2026 14-51-58_1.mp4"), true);
  assert.equal(isScreenRecording("/archive/2024/03/Screen Recording 2024-03-01 at 10.00.00.mov"), true);
  assert.equal(isScreenRecording("/archive/2021/06/IMG_7882.MOV"), false);
  assert.equal(isScreenRecording("/archive/2021/05/4D08DA87-42A1-4A6C-8FED-799ACFB8D3DA.mp4"), false);
  assert.equal(isScreenRecording("/archive/ScreenRecording_folder/IMG_0001.MOV"), false);
});
