import assert from "node:assert/strict";
import test from "node:test";
import {
  builtRunId,
  checkLink,
  handleLinkRequest,
  hashLinkToken,
  LINK_TTL_MS,
  linkUrl,
  looksLikeLinkToken,
  newLinkToken,
  requestEmail,
  requestEmailKey,
  withShipButton,
} from "../convex/lib/chefLinks.ts";

const NOW = 1_800_000_000_000;
const open = { action: "approve", expiresAt: NOW + LINK_TTL_MS };

test("tokens are random, url-safe and stored only as their hash", async () => {
  const a = newLinkToken();
  const b = newLinkToken();
  assert.notEqual(a, b);
  assert.equal(looksLikeLinkToken(a), true);
  assert.equal(looksLikeLinkToken("short"), false);
  assert.equal(looksLikeLinkToken(`${a.slice(0, 42)}!`), false);
  const hash = await hashLinkToken(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await hashLinkToken(a));
  assert.notEqual(hash, await hashLinkToken(b));
  assert.equal(hash.includes(a), false);
});

test("a link works once, for its own action, for 7 days", () => {
  assert.deepEqual(checkLink(open, "approve", NOW), { ok: true });
  assert.deepEqual(checkLink(open, "approve", NOW + LINK_TTL_MS - 1), { ok: true });
  assert.deepEqual(checkLink(open, "approve", NOW + LINK_TTL_MS), { ok: false, reason: "expired" });
  assert.deepEqual(checkLink({ ...open, usedAt: NOW }, "approve", NOW), { ok: false, reason: "used" });
  assert.deepEqual(checkLink(open, "reject", NOW), { ok: false, reason: "wrongAction" });
  assert.deepEqual(checkLink(open, "ship", NOW), { ok: false, reason: "wrongAction" });
  assert.deepEqual(checkLink(null, "approve", NOW), { ok: false, reason: "unknown" });
});

test("a used link says it was used even after it expires", () => {
  assert.deepEqual(checkLink({ ...open, usedAt: NOW }, "approve", NOW + 2 * LINK_TTL_MS), { ok: false, reason: "used" });
});

function fakeDeps(view) {
  const calls = { view: [], use: [] };
  return {
    calls,
    deps: {
      view: async (hash) => {
        calls.view.push(hash);
        return view;
      },
      use: async (hash, form) => {
        calls.use.push({ hash, form });
        return { ok: true, message: "Approved." };
      },
    },
  };
}

const request = { number: 3, title: "A <b>bigger</b> clock", description: "Make it bigger", transcript: null, screenshots: [], audioUrl: null };

test("GET only shows the page and never acts", async () => {
  const token = newLinkToken();
  const { calls, deps } = fakeDeps({ state: "open", action: "approve", request });
  const page = await handleLinkRequest({ method: "GET", url: `https://x.convex.site/chef/link?t=${token}` }, deps);
  assert.equal(page.status, 200);
  assert.equal(calls.use.length, 0);
  assert.deepEqual(calls.view, [await hashLinkToken(token)]);
  assert.match(page.html, /<form method="post" action="\/chef\/link">/);
  assert.match(page.html, /name="action" value="approve"/);
  assert.match(page.html, /Approve and build/);
  // The request's own text is escaped.
  assert.match(page.html, /A &lt;b&gt;bigger&lt;\/b&gt; clock/);
});

test("HEAD and other methods never act either", async () => {
  const token = newLinkToken();
  for (const method of ["HEAD", "PUT", "DELETE", "PATCH"]) {
    const { calls, deps } = fakeDeps({ state: "open", action: "approve", request });
    await handleLinkRequest({ method, url: `https://x.convex.site/chef/link?t=${token}`, form: async () => new URLSearchParams({ t: token, action: "approve" }) }, deps);
    assert.equal(calls.use.length, 0, method);
  }
});

test("GET of a used or expired link says so, with no button", async () => {
  const token = newLinkToken();
  const used = await handleLinkRequest({ method: "GET", url: `https://x/chef/link?t=${token}` }, fakeDeps({ state: "used", action: "approve", outcome: "Approved." }).deps);
  assert.equal(used.status, 410);
  assert.match(used.html, /already|been used/);
  assert.doesNotMatch(used.html, /<form/);
  const expired = await handleLinkRequest({ method: "GET", url: `https://x/chef/link?t=${token}` }, fakeDeps({ state: "expired", action: "reject" }).deps);
  assert.equal(expired.status, 410);
  assert.match(expired.html, /expired/);
  assert.doesNotMatch(expired.html, /<form/);
});

test("a malformed token is refused before anything is looked up", async () => {
  const { calls, deps } = fakeDeps({ state: "unknown" });
  const page = await handleLinkRequest({ method: "GET", url: "https://x/chef/link?t=nope" }, deps);
  assert.equal(page.status, 404);
  assert.equal(calls.view.length, 0);
  const posted = await handleLinkRequest({ method: "POST", url: "https://x/chef/link", form: async () => new URLSearchParams({ t: "nope", action: "approve" }) }, deps);
  assert.equal(posted.status, 404);
  assert.equal(calls.use.length, 0);
});

test("POST passes the token's hash and the form's action on", async () => {
  const token = newLinkToken();
  const { calls, deps } = fakeDeps(null);
  const page = await handleLinkRequest(
    { method: "POST", url: "https://x/chef/link", form: async () => new URLSearchParams({ t: token, action: "ship", diffHash: "abc", deps: "1" }) },
    deps,
  );
  assert.equal(page.status, 200);
  assert.deepEqual(calls.use, [{ hash: await hashLinkToken(token), form: { action: "ship", diffHash: "abc", depsAcknowledged: true } }]);
  assert.match(page.html, /Approved\./);
});

test("a ship page that can't ship has its button disabled", async () => {
  const token = newLinkToken();
  const ship = { runId: "r1", seq: 4, requests: ["#3 Bigger clock"], previewUrl: null, diffHash: null, depsChanged: false, filesChanged: [], blocked: "This build isn't ready to ship (it's failed)." };
  const page = await handleLinkRequest({ method: "GET", url: `https://x/chef/link?t=${token}` }, fakeDeps({ state: "open", action: "ship", ship }).deps);
  assert.match(page.html, /<button class="primary" disabled>Ship it<\/button>/);
  assert.match(page.html, /isn&#39;t ready to ship/);
});

test("the request email has both buttons and escapes the request", () => {
  const email = requestEmail({
    request: { ...request, transcript: "and <script>", screenshots: ["https://x.convex.cloud/api/storage/1"], audioUrl: null },
    approveUrl: linkUrl("https://x.convex.site/", "tok1"),
    rejectUrl: linkUrl("https://x.convex.site", "tok2"),
  });
  assert.equal(email.subject, "[Cannvas] New request #3 A <b>bigger</b> clock");
  assert.match(email.html, /href="https:\/\/x\.convex\.site\/chef\/link\?t=tok1"[^>]*>Approve and build</);
  assert.match(email.html, /href="https:\/\/x\.convex\.site\/chef\/link\?t=tok2"[^>]*>Reject</);
  assert.doesNotMatch(email.html, /<script>|<b>bigger/);
  assert.match(email.text, /Approve and build: https:\/\/x\.convex\.site\/chef\/link\?t=tok1/);
  assert.match(email.text, /Voice note:\nand <script>/);
});

test("Ship it goes right after the preview link in Chef's built email", () => {
  assert.equal(builtRunId("chef-k57abc123-built"), "k57abc123");
  assert.equal(builtRunId("chef-k57abc123-failed"), null);
  assert.equal(builtRunId("release-3-shipped"), null);
  const email = withShipButton(
    { html: '<div><p>Chef built</p><p><a href="https://p.convex.site">Open the preview</a></p><p>more</p></div>', text: "Chef built\n\nPreview: https://p.convex.site\nRun: x" },
    "https://x.convex.site/chef/link?t=s",
  );
  assert.match(email.html, /Open the preview<\/a><\/p><p><a href="https:\/\/x\.convex\.site\/chef\/link\?t=s"[^>]*>Ship it</);
  assert.equal(email.text, "Chef built\n\nPreview: https://p.convex.site\nShip it: https://x.convex.site/chef/link?t=s\nRun: x");
});

test("each request email gets its own idempotency key", () => {
  assert.equal(requestEmailKey("item1", "delivery1"), "cannvas-request-item1-delivery1");
  assert.notEqual(requestEmailKey("item1", "delivery1"), requestEmailKey("item1", "delivery2"));
});

