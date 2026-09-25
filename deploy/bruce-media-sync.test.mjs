import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
  conversionFailureBackoffMs,
  isBrowserCompatibleCodec,
  isEligibleVideo,
  isGeneratedPartialName,
  isScreenRecording,
  partialPath,
  positiveInteger,
  removeOrphans,
} from "./bruce-media-sync.mjs";

test("keeps Chromium-compatible codecs direct", () => {
  assert.equal(isBrowserCompatibleCodec('( "H.264", "MPEG-4 AAC" )'), true);
  assert.equal(isBrowserCompatibleCodec('( VP9, Opus )'), true);
  assert.equal(isBrowserCompatibleCodec('( "MPEG-4 AVC", "MPEG-4 AAC" )'), true);
  assert.equal(isBrowserCompatibleCodec('( VP8, Vorbis )'), true);
});

test("transcodes HEVC and unknown codecs", () => {
  assert.equal(isBrowserCompatibleCodec('( HEVC, "MPEG-4 AAC" )'), false);
  assert.equal(isBrowserCompatibleCodec('( HEVC, "H.264" )'), false);
  assert.equal(isBrowserCompatibleCodec('( "H.265", "MPEG-4 AAC" )'), false);
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

test("writes conversion partials as hidden files", () => {
  const partial = partialPath("/cache/2024/IMG_1.MOV.m4v", 123);
  assert.equal(partial, "/cache/2024/.IMG_1.MOV.m4v.partial-123.m4v");
  assert.equal(isGeneratedPartialName(basename(partial)), true);
});

test("falls back when the scan concurrency setting is not a positive number", () => {
  assert.equal(positiveInteger(undefined, 8), 8);
  assert.equal(positiveInteger("abc", 8), 8);
  assert.equal(positiveInteger("0", 8), 8);
  assert.equal(positiveInteger("3.7", 8), 3);
});

test("removes cached videos whose source is gone and keeps everything else", async () => {
  const root = await mkdtemp(join(tmpdir(), "cannvas-orphans-"));
  try {
    await mkdir(join(root, "2024"));
    const kept = join(root, "2024", "kept.MOV.m4v");
    const orphan = join(root, "2024", "deleted.MOV.m4v");
    const orphanLink = join(root, "2024", "moved.mp4");
    const partial = join(root, "2024", ".kept.MOV.m4v.partial-1.m4v");
    const notVideo = join(root, "2024", "notes.txt");
    await Promise.all([kept, orphan, partial, notVideo].map((path) => writeFile(path, "x")));
    await symlink("/nowhere/moved.mp4", orphanLink);

    assert.equal(await removeOrphans(root, new Set([kept])), 2);
    assert.deepEqual((await readdir(join(root, "2024"))).sort(), [".kept.MOV.m4v.partial-1.m4v", "kept.MOV.m4v", "notes.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
