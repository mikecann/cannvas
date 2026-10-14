import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker.ts";

const assetCalls = [];
const assets = { fetch: async request => {
  assetCalls.push(new URL(request.url).pathname);
  return new Response("asset");
} };

test("inventory routing remains on Cannvas before cutover", async () => {
  const response = await worker.fetch(new Request("https://cannvas.mikecann.app/inventory/"), { ASSETS: assets, INVENTORY_ORIGIN: "" });
  assert.equal(response.status, 200);
  assert.equal(assetCalls.at(-1), "/inventory/index.html");
});

test("cutover redirects inventory and Giveaway and preserves query strings", async () => {
  for (const [path, destination] of [["/inventory/", "/"], ["/inventory", "/"], ["/giveaway/", "/giveaway/"]]) {
    const response = await worker.fetch(new Request("https://cannvas.mikecann.app" + path + "?from=phone"), { ASSETS: assets, INVENTORY_ORIGIN: "https://inventory.mikecann.app" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://inventory.mikecann.app" + destination + "?from=phone");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("unknown redirect origin is rejected and the launcher remains unchanged", async () => {
  const response = await worker.fetch(new Request("https://cannvas.mikecann.app/inventory/"), { ASSETS: assets, INVENTORY_ORIGIN: "https://untrusted.example" });
  assert.equal(response.status, 200);
  const root = await worker.fetch(new Request("https://cannvas.mikecann.app/"), { ASSETS: assets, INVENTORY_ORIGIN: "https://inventory.mikecann.app" });
  assert.equal(root.status, 200);
  assert.equal(assetCalls.at(-1), "/apps/index.html");
});

test("existing installed apps can discover cutover while the worker file remains available", async () => {
  const env = { ASSETS: assets, INVENTORY_ORIGIN: "https://inventory.mikecann.app" };
  const metadata = await worker.fetch(new Request("https://cannvas.mikecann.app/inventory/migration.json"), env);
  assert.deepEqual(await metadata.json(), { origin: "https://inventory.mikecann.app" });
  const serviceWorker = await worker.fetch(new Request("https://cannvas.mikecann.app/inventory/sw.js"), env);
  assert.equal(serviceWorker.status, 200);
  assert.equal(assetCalls.at(-1), "/inventory/sw.js");
});
