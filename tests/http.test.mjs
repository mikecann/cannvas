import assert from "node:assert/strict";
import test from "node:test";
import { readJsonResponse } from "../src/lib/http.ts";

const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("returns the parsed body of a JSON success", async () => {
  assert.deepEqual(await readJsonResponse(json(200, { configured: true }), "fallback"), { configured: true });
});

test("uses the server's error message on a JSON failure", async () => {
  await assert.rejects(readJsonResponse(json(502, { error: "Home Assistant is unavailable" }), "fallback"), /Home Assistant is unavailable/);
});

test("does not try to parse an HTML error page", async () => {
  const page = new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } });
  await assert.rejects(readJsonResponse(page, "Solar data is unavailable"), /Solar data is unavailable/);
});

test("rejects a success that is not JSON", async () => {
  const page = new Response("<html>index</html>", { status: 200, headers: { "Content-Type": "text/html" } });
  await assert.rejects(readJsonResponse(page, "Solar data is unavailable"), /Solar data is unavailable/);
});

test("rejects malformed JSON", async () => {
  const broken = new Response("{", { status: 200, headers: { "Content-Type": "application/json" } });
  await assert.rejects(readJsonResponse(broken, "fallback"), /fallback/);
});
