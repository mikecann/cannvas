import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker.ts";
import { readFileSync } from "node:fs";
import vm from "node:vm";

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

test("an installed app can activate cutover without caching a cross-origin redirect", async () => {
  const listeners = {};
  const deleted = [];
  const navigated = [];
  let skipped = false;
  let unregistered = false;
  const context = {
    URL, Response,
    fetch: async () => Response.json({ origin: "https://inventory.mikecann.app" }),
    caches: {
      open: async () => { throw new Error("The redirected old shell must not be cached"); },
      keys: async () => ["cannvas-inventory-v3", "unrelated-cache"],
      delete: async name => { deleted.push(name); return true; },
    },
    self: {
      addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: async () => { skipped = true; },
      clients: {
        claim: async () => {},
        matchAll: async () => [{ url: "https://cannvas.mikecann.app/inventory/?from=home#item", navigate: async url => navigated.push(url) }],
      },
      registration: { unregister: async () => { unregistered = true; } },
    },
  };
  vm.runInNewContext(readFileSync(new URL("../public/inventory/sw.js", import.meta.url), "utf8"), context);
  for (const name of ["install", "activate"]) {
    const pending = [];
    listeners[name]({ waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
  }
  assert.equal(skipped, true);
  assert.equal(unregistered, true);
  assert.deepEqual(navigated, ["https://inventory.mikecann.app/?from=home#item"]);
  assert.deepEqual([...new Set(deleted)], ["cannvas-inventory-v3"]);
});
