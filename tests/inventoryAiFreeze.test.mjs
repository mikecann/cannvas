import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Bundle the actual registered handlers so the check covers their write gates,
// without a deployment, credentials or a database containing household records.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { buildSync } = wranglerRequire("esbuild");
const output = buildSync({
  entryPoints: [new URL("../convex/inventoryAiStore.ts", import.meta.url).pathname],
  bundle: true, platform: "node", format: "esm", write: false,
});
const store = await import("data:text/javascript;base64," + Buffer.from(output.outputFiles[0].contents).toString("base64"));

test("paused source rejects every scheduled AI write before touching the database", async () => {
  const previous = process.env.INVENTORY_READ_ONLY;
  process.env.INVENTORY_READ_ONLY = "1";
  const forbidden = new Proxy({}, { get() { throw new Error("Paused work touched storage or the scheduler"); } });
  try {
    const context = { db: forbidden, scheduler: forbidden };
    assert.equal(await store.markProcessing._handler(context, {}), false);
    for (const name of ["applyEnrichment", "markFailed", "expireProcessing"]) {
      assert.equal(await store[name]._handler(context, {}), null);
    }
  } finally {
    if (previous === undefined) delete process.env.INVENTORY_READ_ONLY;
    else process.env.INVENTORY_READ_ONLY = previous;
  }
});

test("normal AI handlers retain their existing missing-item behavior", async () => {
  const previous = process.env.INVENTORY_READ_ONLY;
  delete process.env.INVENTORY_READ_ONLY;
  let reads = 0;
  const context = { db: { get: async () => { reads++; return null; } } };
  try {
    for (const name of ["markProcessing", "applyEnrichment", "markFailed", "expireProcessing"]) {
      await store[name]._handler(context, { itemId: "fixture", generation: 1 });
    }
    assert.equal(reads, 4);
  } finally {
    if (previous !== undefined) process.env.INVENTORY_READ_ONLY = previous;
  }
});
