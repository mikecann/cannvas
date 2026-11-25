import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
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

test("answers 400 for malformed percent escapes", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "cannvas-media-"));
  const cache = join(temporary, "cache");
  const source = join(temporary, "source");
  await mkdir(cache);
  await mkdir(source);

  const server = createMediaServer({ root: cache, sourceRoot: source });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(async () => {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporary, { recursive: true, force: true });
  });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/clip%ZZ.mp4`);
  assert.equal(response.status, 400);
});

test("closes the file when a client drops a video part way", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "cannvas-media-"));
  const cache = join(temporary, "cache");
  const source = join(temporary, "source");
  await mkdir(cache);
  await mkdir(source);
  // Bigger than the socket buffers, so the read stream is still open when the client goes.
  await writeFile(join(cache, "long.mp4"), Buffer.alloc(32 * 1024 * 1024));

  const server = createMediaServer({ root: cache, sourceRoot: source });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporary, { recursive: true, force: true });
  });

  const openFiles = () => readdirSync("/dev/fd").length;
  const before = openFiles();
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolveDrop, rejectDrop) => {
      const clientRequest = request({ port: server.address().port, host: "127.0.0.1", path: "/long.mp4" }, (response) => {
        response.once("data", () => {
          clientRequest.destroy();
          resolveDrop();
        });
      });
      clientRequest.on("error", rejectDrop);
      clientRequest.end();
    });
  }
  // Give the server a moment to notice the closed sockets.
  for (let wait = 0; wait < 50 && openFiles() > before + 2; wait += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.ok(openFiles() <= before + 2, `${openFiles() - before} files left open after 10 dropped requests`);
});

test("answers empty files, suffix ranges and clients that leave early without crashing", async (context) => {
  const temporary = await mkdtemp(join(tmpdir(), "cannvas-media-"));
  const cache = join(temporary, "cache");
  const source = join(temporary, "source");
  await mkdir(cache);
  await mkdir(source);
  await writeFile(join(cache, "empty.mp4"), "");
  await writeFile(join(cache, "digits.mp4"), "0123456789");

  const server = createMediaServer({ root: cache, sourceRoot: source });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(async () => {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temporary, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const empty = await fetch(`${base}/empty.mp4`);
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), "");

  const tail = await fetch(`${base}/digits.mp4`, { headers: { Range: "bytes=-3" } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get("content-range"), "bytes 7-9/10");
  assert.equal(await tail.text(), "789");
  const whole = await fetch(`${base}/digits.mp4`, { headers: { Range: "bytes=-50" } });
  assert.equal(await whole.text(), "0123456789");
  assert.equal((await fetch(`${base}/digits.mp4`, { headers: { Range: "bytes=-0" } })).status, 416);

  // Leave while the server is still looking the file up. Before the fix this was an unhandled
  // rejection (a second writeHead), which ends a real server process.
  const failures = [];
  const onFailure = (error) => failures.push(error);
  process.on("unhandledRejection", onFailure);
  context.after(() => process.off("unhandledRejection", onFailure));
  let received = 0;
  server.on("request", () => { received += 1; });
  for (let i = 0; i < 20; i += 1) {
    const early = request({ port: server.address().port, host: "127.0.0.1", path: "/digits.mp4" });
    early.on("error", () => {});
    early.end();
    setImmediate(() => early.destroy());
  }
  for (let wait = 0; wait < 250 && received < 20; wait += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  // This request's lookup queues behind theirs, so once it answers they've all finished theirs.
  assert.equal((await fetch(`${base}/digits.mp4`)).status, 200);
  assert.deepEqual(failures, []);
});
