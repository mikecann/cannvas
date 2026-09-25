import assert from "node:assert/strict";
import test from "node:test";
import { syncBackoffMs } from "../convex/lib/backoff.ts";
import { bearerTokenMatches, tokensMatch } from "../convex/lib/tokens.ts";

test("tokens only match exactly", () => {
  assert.equal(tokensMatch("abc123", "abc123"), true);
  assert.equal(tokensMatch("abc124", "abc123"), false);
  assert.equal(tokensMatch("abc12", "abc123"), false);
  assert.equal(tokensMatch("abc1234", "abc123"), false);
  assert.equal(tokensMatch("", "abc123"), false);
});

test("an unset expected token never matches", () => {
  assert.equal(tokensMatch("", ""), false);
  assert.equal(tokensMatch("anything", ""), false);
});

test("bearer headers need the scheme and the exact token", () => {
  assert.equal(bearerTokenMatches("Bearer secret", "secret"), true);
  assert.equal(bearerTokenMatches("bearer secret", "secret"), false);
  assert.equal(bearerTokenMatches("Bearer secret2", "secret"), false);
  assert.equal(bearerTokenMatches("secret", "secret"), false);
  assert.equal(bearerTokenMatches(null, "secret"), false);
});

test("failed Google pushes back off and cap at six hours", () => {
  assert.equal(syncBackoffMs(1), 2 * 60_000);
  assert.equal(syncBackoffMs(2), 4 * 60_000);
  assert.equal(syncBackoffMs(3), 8 * 60_000);
  assert.equal(syncBackoffMs(50), 6 * 60 * 60_000);
});
