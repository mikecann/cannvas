// The buttons in Chef's emails to Mike (Approve and build, Reject, Ship it).
// Each one links to /chef/link?t=<token>: a random, single-use token, stored
// only as its SHA-256, bound to one request (or build) and one action, and
// good for 7 days. A GET only shows what the button would do, with a confirm
// button. The action happens on that page's POST, because Gmail and link
// scanners fetch links on their own.
//
// Also the emails those buttons are in. No Convex imports here, so
// tests/chefLinks.test.mjs can run it in Node.

export const LINK_TTL_MS = 7 * 24 * 60 * 60_000;
export const LINK_PATH = "/chef/link";

export type LinkAction = "approve" | "reject" | "ship";
export const LINK_ACTIONS: readonly LinkAction[] = ["approve", "reject", "ship"];

export type LinkRow = { action: LinkAction; expiresAt: number; usedAt?: number; outcome?: string };

export type LinkCheck =
  | { ok: true }
  | { ok: false; reason: "unknown" | "used" | "expired" | "wrongAction" };

// 32 random bytes, base64url: 43 characters.
export function newLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function looksLikeLinkToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function hashLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isLinkAction(value: unknown): value is LinkAction {
  return typeof value === "string" && (LINK_ACTIONS as readonly string[]).includes(value);
}

// Whether a stored link may do `action` now. Used first, then expired, so a
// used link always says what it did.
export function checkLink(row: LinkRow | null, action: string, now: number): LinkCheck {
  if (!row) return { ok: false, reason: "unknown" };
  if (row.usedAt !== undefined) return { ok: false, reason: "used" };
  if (now >= row.expiresAt) return { ok: false, reason: "expired" };
  if (row.action !== action) return { ok: false, reason: "wrongAction" };
  return { ok: true };
}

// ---------- What the pages show ----------

export type LinkRequest = {
  number: number | null;
  title: string;
  description: string;
  transcript: string | null;
  screenshots: string[];
  audioUrl: string | null;
};

export type LinkShip = {
  runId: string;
  seq: number | null;
  requests: string[];
  previewUrl: string | null;
  diffHash: string | null;
  depsChanged: boolean;
  filesChanged: string[];
  // Why "Ship it" can't ship this build now; null when it can.
  blocked: string | null;
};

export type LinkView =
  | { state: "unknown" }
  | { state: "used"; action: LinkAction; outcome: string }
  | { state: "expired"; action: LinkAction }
  | { state: "open"; action: "approve" | "reject"; request: LinkRequest }
  | { state: "open"; action: "ship"; ship: LinkShip };

export type LinkForm = { action: string; diffHash?: string; depsAcknowledged?: boolean };
export type LinkResult = { ok: boolean; message: string };

export type LinkDeps = {
  // Read only: what the link is for and whether it can still be used.
  view: (tokenHash: string) => Promise<LinkView>;
  // Checks the link again, acts, and marks it used, in one transaction.
  use: (tokenHash: string, form: LinkForm) => Promise<LinkResult>;
};

export type LinkResponse = { status: number; html: string };

// GET shows; only POST acts. Anything else is refused.
export async function handleLinkRequest(
  request: { method: string; url: string; form?: () => Promise<URLSearchParams> },
  deps: LinkDeps,
): Promise<LinkResponse> {
  if (request.method === "GET" || request.method === "HEAD") {
    const token = new URL(request.url).searchParams.get("t");
    if (!looksLikeLinkToken(token)) return { status: 404, html: messagePage("Link not found", NOT_FOUND) };
    const view = await deps.view(await hashLinkToken(token));
    return viewPage(view, token);
  }
  if (request.method === "POST") {
    const form = request.form ? await request.form() : new URLSearchParams();
    const token = form.get("t");
    if (!looksLikeLinkToken(token)) return { status: 404, html: messagePage("Link not found", NOT_FOUND) };
    const result = await deps.use(await hashLinkToken(token), {
      action: form.get("action") ?? "",
      ...(form.get("diffHash") ? { diffHash: form.get("diffHash")! } : {}),
      ...(form.get("deps") === "1" ? { depsAcknowledged: true } : {}),
    });
    return {
      status: result.ok ? 200 : 409,
      html: messagePage(result.ok ? "Done" : "Not done", `<p class="${result.ok ? "ok" : "bad"}">${escapeHtml(result.message)}</p>`),
    };
  }
  return { status: 405, html: messagePage("Not allowed", "<p>Open the link from the email.</p>") };
}

const NOT_FOUND = "<p>This link isn't one Cannvas made. Use the buttons in the email.</p>";

const ACTION_WORDS: Record<LinkAction, { title: string; button: string }> = {
  approve: { title: "Approve and build?", button: "Approve and build" },
  reject: { title: "Reject this request?", button: "Reject" },
  ship: { title: "Ship it to the wall?", button: "Ship it" },
};

function viewPage(view: LinkView, token: string): LinkResponse {
  if (view.state === "unknown") return { status: 404, html: messagePage("Link not found", NOT_FOUND) };
  if (view.state === "used") {
    return { status: 410, html: messagePage("Already used", `<p>This link has been used. ${escapeHtml(view.outcome)}</p>`) };
  }
  if (view.state === "expired") {
    return {
      status: 410,
      html: messagePage("Link expired", "<p>Links in Chef's emails last 7 days. The README's Chef section says how to get a new one.</p>"),
    };
  }
  const words = ACTION_WORDS[view.action];
  const hidden = [`<input type="hidden" name="t" value="${escapeHtml(token)}">`, `<input type="hidden" name="action" value="${view.action}">`];
  let body: string;
  let disabled = false;
  if (view.action === "ship") {
    const ship = view.ship;
    if (ship.diffHash) hidden.push(`<input type="hidden" name="diffHash" value="${escapeHtml(ship.diffHash)}">`);
    if (ship.depsChanged) hidden.push(`<input type="hidden" name="deps" value="1">`);
    disabled = ship.blocked !== null || !ship.diffHash;
    body = [
      `<p>Build${ship.seq !== null ? ` #${ship.seq}` : ""}:</p>`,
      ship.requests.length ? `<ul>${ship.requests.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : "",
      ship.previewUrl ? `<p><a href="${escapeHtml(ship.previewUrl)}">Open the preview</a></p>` : "",
      ship.filesChanged.length
        ? `<details><summary>${ship.filesChanged.length} file${ship.filesChanged.length === 1 ? "" : "s"} changed</summary><ul>${ship.filesChanged
            .slice(0, 50)
            .map((f) => `<li><code>${escapeHtml(f)}</code></li>`)
            .join("")}</ul></details>`
        : "",
      ship.depsChanged ? `<p class="warn">This build changes dependencies. Shipping it accepts that.</p>` : "",
      `<p class="note">Ship it deploys the backend and moves Chef's main. The wall's own screen only changes after <code>deploy/ship-from-chef.sh</code>.</p>`,
      ship.blocked ? `<p class="bad">${escapeHtml(ship.blocked)}</p>` : "",
    ].join("");
  } else {
    const r = view.request;
    body = [
      `<h2>${r.number !== null ? `#${r.number} ` : ""}${escapeHtml(r.title)}</h2>`,
      r.description ? `<div class="text">${escapeHtml(r.description)}</div>` : "",
      r.transcript ? `<p class="label">Voice note</p><div class="text">${escapeHtml(r.transcript)}</div>` : "",
      r.audioUrl ? `<audio controls preload="none" src="${escapeHtml(r.audioUrl)}"></audio>` : "",
      r.screenshots.map((url) => `<a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="Screenshot"></a>`).join(""),
    ].join("");
  }
  const form = `<form method="post" action="${LINK_PATH}">${hidden.join("")}<button class="${view.action === "reject" ? "danger" : "primary"}"${disabled ? " disabled" : ""}>${words.button}</button></form>`;
  return { status: 200, html: page(words.title, `<h1>${words.title}</h1>${body}${form}`) };
}

function messagePage(title: string, body: string) {
  return page(title, `<h1>${escapeHtml(title)}</h1>${body}`);
}

function page(title: string, body: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)} · Cannvas</title>
<style>
body{margin:0;background:#eee8dc;color:#25282c;font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 18px 40px}
.card{background:#fffdf8;border-radius:22px;padding:22px;box-shadow:0 18px 50px rgba(64,53,38,.12)}
h1{font:700 1.6rem/1.15 Georgia,serif;margin:0 0 14px}h2{font-size:1.1rem;margin:0 0 8px}
.eyebrow{margin:0 0 6px;color:#ff765e;font-size:.8rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}
.text{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4eee3;border-radius:12px;padding:12px;margin:0 0 12px}
.label{margin:0 0 4px;color:#716e68;font-size:.85rem;font-weight:700}
img{display:block;max-width:100%;border-radius:12px;border:1px solid #d9d1c5;margin:0 0 12px}audio{width:100%;margin:0 0 12px}
button{width:100%;min-height:54px;margin-top:8px;border:0;border-radius:17px;font:inherit;font-weight:800;color:#fff;background:#25282c}
button.danger{background:#d74c43}button:disabled{opacity:.35}
.ok{color:#168b70;font-weight:700}.bad{color:#b3412f;font-weight:700}.warn{color:#9a5b00}.note{color:#716e68;font-size:.9rem}
code{font-size:.85em;overflow-wrap:anywhere}a{color:#25282c}
</style></head><body><main><p class="eyebrow">Cannvas · Chef</p><div class="card">${body}</div></main></body></html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- The emails ----------

export function linkUrl(siteUrl: string, token: string) {
  return `${siteUrl.replace(/\/+$/, "")}${LINK_PATH}?t=${encodeURIComponent(token)}`;
}

// A link styled as a button that survives Gmail's and Apple Mail's CSS.
function buttonHtml(href: string, label: string, color: string) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;border-radius:12px;background:${color};color:#ffffff;font-weight:700;text-decoration:none">${escapeHtml(label)}</a>`;
}

export function requestEmail(input: { request: LinkRequest; approveUrl: string; rejectUrl: string }) {
  const { request, approveUrl, rejectUrl } = input;
  const name = `${request.number !== null ? `#${request.number} ` : ""}${request.title}`;
  const subject = `[Cannvas] New request ${name}`.replace(/\s+/g, " ").slice(0, 160);
  const text = [
    `Someone at the wall asked for: ${name}`,
    "",
    ...(request.description ? [request.description, ""] : []),
    ...(request.transcript ? ["Voice note:", request.transcript, ""] : []),
    ...(request.screenshots.length ? [`Screenshots: ${request.screenshots.join(" ")}`, ""] : []),
    ...(request.audioUrl ? [`Voice note recording: ${request.audioUrl}`, ""] : []),
    `Approve and build: ${approveUrl}`,
    `Reject: ${rejectUrl}`,
    "",
    "Each link opens a page that asks you to confirm. It works once, for 7 days.",
  ].join("\n");
  const block = (value: string) =>
    `<div style="white-space:pre-wrap;background:#f4eee3;border-radius:10px;padding:12px;margin:0 0 12px">${escapeHtml(value)}</div>`;
  const html = [
    `<div style="font-family:-apple-system,system-ui,sans-serif;font-size:15px;line-height:1.5;color:#25282c">`,
    `<p>Someone at the wall asked for <strong>${escapeHtml(name)}</strong></p>`,
    request.description ? block(request.description) : "",
    request.transcript ? `<p style="margin:0 0 4px;color:#716e68">Voice note:</p>${block(request.transcript)}` : "",
    request.screenshots
      .map((url) => `<p><a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="Screenshot" width="320" style="display:block;max-width:100%;border:1px solid #d9d1c5;border-radius:8px"></a></p>`)
      .join(""),
    request.audioUrl ? `<p><a href="${escapeHtml(request.audioUrl)}">Play the voice note</a></p>` : "",
    `<p>${buttonHtml(approveUrl, "Approve and build", "#168b70")}${buttonHtml(rejectUrl, "Reject", "#d74c43")}</p>`,
    `<p style="font-size:13px;color:#716e68">Each button opens a page that asks you to confirm. It works once, for 7 days.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

// One request email's idempotency key. `deliveryId` is new for every email
// Cannvas means to send, so only a retry of the same send is deduplicated.
export function requestEmailKey(itemId: string, deliveryId: string) {
  return `cannvas-request-${itemId}-${deliveryId}`;
}

// Chef's "built" email's idempotency key is `chef-<runId>-built`.
export function builtRunId(idempotencyKey: string): string | null {
  return idempotencyKey.match(/^chef-([a-z0-9]+)-built$/)?.[1] ?? null;
}

// Adds Ship it after the preview link (or at the top when there's none).
export function withShipButton(email: { html: string; text: string }, shipUrl: string) {
  const button = `<p>${buttonHtml(shipUrl, "Ship it", "#25282c")}<br><span style="font-size:13px;color:#555">Opens a page that asks you to confirm. Then run deploy/ship-from-chef.sh to put it on the wall.</span></p>`;
  const previewLink = /(<p><a href="[^"]*">Open the preview<\/a><\/p>)/;
  const html = previewLink.test(email.html)
    ? email.html.replace(previewLink, `$1${button}`)
    : email.html.replace(/(<\/p>)/, `$1${button}`);
  const lines = email.text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("Preview: "));
  lines.splice(at >= 0 ? at + 1 : 2, 0, `Ship it: ${shipUrl}`);
  return { html, text: lines.join("\n") };
}
