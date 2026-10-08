import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMediaServer, isVideo, loadToken, requestHostname } from "./bruce-media-server.mjs";

const token = "t".repeat(40);
const authorized = { Authorization: `Bearer ${token}` };

async function startServer(context, options) {
  const server = createMediaServer({ token, ...options });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => new Promise((resolveClose) => server.close(resolveClose)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function emptyLibrary(context) {
  const temporary = await mkdtemp(join(tmpdir(), "cannvas-media-"));
  const cache = join(temporary, "cache");
  const source = join(temporary, "source");
  await mkdir(cache);
  await mkdir(source);
  context.after(() => rm(temporary, { recursive: true, force: true }));
  return { temporary, cache, source };
}

// fetch() won't let a caller choose the Host header, so this uses node:http.
function getWithHost(base, host, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest(`${base}/`, { headers: { ...headers, Host: host } }, (response) => {
      response.resume();
      response.on("end", () => resolveRequest(response.statusCode));
    });
    request.on("error", rejectRequest);
    request.end();
  });
}

test("recognises only supported video extensions", () => {
  assert.equal(isVideo("clip.MOV"), true);
  assert.equal(isVideo("clip.mp4"), true);
  assert.equal(isVideo("photo.jpg"), false);
  assert.equal(isVideo("metadata.xmp"), false);
});

test("lists videos but not photos or sidecars", async (context) => {
  const { cache, source } = await emptyLibrary(context);
  await writeFile(join(cache, "clip.mp4"), "video");
  await writeFile(join(cache, "photo.jpg"), "photo");
  await writeFile(join(cache, "clip.xmp"), "sidecar");

  const base = await startServer(context, { root: cache, sourceRoot: source });
  const body = await (await fetch(`${base}/`, { headers: authorized })).text();
  assert.match(body, /clip\.mp4/);
  assert.doesNotMatch(body, /photo\.jpg/);
  assert.doesNotMatch(body, /clip\.xmp/);
});

test("serves approved source symlinks and rejects links outside the archive", async (context) => {
  const { temporary, cache, source } = await emptyLibrary(context);
  const outside = join(temporary, "outside");
  await mkdir(outside);
  await writeFile(join(source, "family.mp4"), "family-video");
  await writeFile(join(outside, "private.mp4"), "not-for-serving");
  await symlink(join(source, "family.mp4"), join(cache, "family.mp4"));
  await symlink(join(outside, "private.mp4"), join(cache, "private.mp4"));

  const base = await startServer(context, { root: cache, sourceRoot: source });
  assert.equal(await (await fetch(`${base}/family.mp4`, { headers: authorized })).text(), "family-video");
  assert.equal((await fetch(`${base}/private.mp4`, { headers: authorized })).status, 403);
});

test("answers 400 for malformed percent escapes", async (context) => {
  const { cache, source } = await emptyLibrary(context);
  const base = await startServer(context, { root: cache, sourceRoot: source });
  const response = await fetch(`${base}/clip%ZZ.mp4`, { headers: authorized });
  assert.equal(response.status, 400);
});

test("refuses requests without the right token", async (context) => {
  const { cache, source } = await emptyLibrary(context);
  await writeFile(join(cache, "clip.mp4"), "video");
  const base = await startServer(context, { root: cache, sourceRoot: source });

  for (const headers of [{}, { Authorization: "Bearer wrong" }, { Authorization: token }, { Authorization: `Basic ${token}` }]) {
    const response = await fetch(`${base}/clip.mp4`, { headers });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.doesNotMatch(await response.text(), /video/);
  }
});

test("answers only Bruce's own host names", async (context) => {
  const { cache, source } = await emptyLibrary(context);
  const base = await startServer(context, { root: cache, sourceRoot: source, allowedHosts: ["bruce.local"] });

  assert.equal(await getWithHost(base, "bruce.local:6113", authorized), 200);
  assert.equal(await getWithHost(base, "BRUCE.local.", authorized), 200);
  assert.equal(await getWithHost(base, "rebind.example:6113", authorized), 403);
  assert.equal(await getWithHost(base, "bruce.local@rebind.example", authorized), 403);
  // The Host check comes first, so a rebound page learns nothing about the token.
  assert.equal(await getWithHost(base, "rebind.example"), 403);
});

test("reads a host name from a Host header", () => {
  assert.equal(requestHostname("bruce.local:6113"), "bruce.local");
  assert.equal(requestHostname("[::1]:6113"), "[::1]");
  assert.equal(requestHostname("bruce.local/evil"), null);
  assert.equal(requestHostname(""), null);
  assert.equal(requestHostname(undefined), null);
});

test("will not start without a long enough token", async (context) => {
  const { temporary, cache, source } = await emptyLibrary(context);
  assert.throws(() => createMediaServer({ root: cache, sourceRoot: source, token: "" }), /token/);
  assert.throws(() => createMediaServer({ root: cache, sourceRoot: source, token: "short" }), /token/);

  const tokenFile = join(temporary, "token");
  await writeFile(tokenFile, `${token}\n`);
  assert.equal(loadToken({ CANNVAS_MEDIA_TOKEN_FILE: tokenFile }), token);
  assert.equal(loadToken({}), "");
});
