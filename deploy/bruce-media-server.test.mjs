import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMediaServer, isVideo } from "./bruce-media-server.mjs";

test("recognises only supported video extensions", () => {
  assert.equal(isVideo("clip.MOV"), true);
  assert.equal(isVideo("clip.mp4"), true);
  assert.equal(isVideo("photo.jpg"), false);
  assert.equal(isVideo("metadata.xmp"), false);
});

test("lists videos but not photos or sidecars", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "cannvas-media-"));
  const cache = join(temporary, "cache");
  const source = join(temporary, "source");
  await mkdir(cache);
  await mkdir(source);
  await writeFile(join(cache, "clip.mp4"), "video");
  await writeFile(join(cache, "photo.jpg"), "photo");
  await writeFile(join(cache, "clip.xmp"), "sidecar");

  const server = createMediaServer({ root: cache, sourceRoot: source });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporary, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
  const body = await response.text();
  assert.match(body, /clip\.mp4/);
  assert.doesNotMatch(body, /photo\.jpg/);
  assert.doesNotMatch(body, /clip\.xmp/);
});

test("serves approved source symlinks and rejects links outside the archive", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "cannvas-media-"));
  const cache = join(temporary, "cache");
  const source = join(temporary, "source");
  const outside = join(temporary, "outside");
  await mkdir(cache);
  await mkdir(source);
  await mkdir(outside);
  await writeFile(join(source, "family.mp4"), "family-video");
  await writeFile(join(outside, "private.mp4"), "not-for-serving");
  await symlink(join(source, "family.mp4"), join(cache, "family.mp4"));
  await symlink(join(outside, "private.mp4"), join(cache, "private.mp4"));

  const server = createMediaServer({ root: cache, sourceRoot: source });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporary, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(`${base}/family.mp4`)).text(), "family-video");
  assert.equal((await fetch(`${base}/private.mp4`)).status, 403);
});
