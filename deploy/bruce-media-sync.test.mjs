import assert from "node:assert/strict";
import test from "node:test";
import { isBrowserCompatibleCodec } from "./bruce-media-sync.mjs";

test("keeps Chromium-compatible codecs direct", () => {
  assert.equal(isBrowserCompatibleCodec('( "H.264", "MPEG-4 AAC" )'), true);
  assert.equal(isBrowserCompatibleCodec('( VP9, Opus )'), true);
});

test("transcodes HEVC and unknown codecs", () => {
  assert.equal(isBrowserCompatibleCodec('( HEVC, "MPEG-4 AAC" )'), false);
  assert.equal(isBrowserCompatibleCodec('( HEVC, "H.264" )'), false);
  assert.equal(isBrowserCompatibleCodec('(null)'), false);
});
