// The email buttons' links: made when an email is sent, looked at by the
// page's GET, used by its POST (convex/lib/chefLinks.ts has the rules and the
// pages; convex/http.ts mounts /chef/link). Each acts on Chef as Mike, the
// admin, through the feedback component, never through the public chef:*
// functions, which only ever see the wall or signed-out callers.
import { Feedback } from "@convex-dev/feedback";
import { v, type GenericId } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  checkLink,
  hashLinkToken,
  isLinkAction,
  LINK_TTL_MS,
  newLinkToken,
  type LinkRequest,
  type LinkResult,
  type LinkShip,
  type LinkView,
} from "./lib/chefLinks";
import { CHEF_ADMIN_ID } from "./lib/chefWall";

const feedback = new Feedback(components.feedback);
// Chef's item ids, as the feedback component's own table names them.
const asItemId = (id: string) => id as GenericId<"items">;

const vRequest = v.object({
  number: v.union(v.number(), v.null()),
  title: v.string(),
  description: v.string(),
  transcript: v.union(v.string(), v.null()),
  screenshots: v.array(v.string()),
  audioUrl: v.union(v.string(), v.null()),
});

async function insertLink(ctx: MutationCtx, fields: Omit<Doc<"chefLinks">, "_id" | "_creationTime" | "tokenHash" | "expiresAt">) {
  const token = newLinkToken();
  await ctx.db.insert("chefLinks", {
    ...fields,
    tokenHash: await hashLinkToken(token),
    expiresAt: Date.now() + LINK_TTL_MS,
  });
  return token;
}

async function findLink(ctx: QueryCtx, tokenHash: string) {
  return await ctx.db
    .query("chefLinks")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
}

// What a request email shows: exactly the snapshot Approve approves.
async function snapshotRequest(ctx: QueryCtx, snapshotId: string): Promise<LinkRequest | null> {
  const found = await feedback.chefSnapshots.get(ctx, { snapshotId, viewer: CHEF_ADMIN_ID }).catch(() => null);
  if (!found) return null;
  const { snapshot, attachmentUrls } = found;
  const item = await feedback.items.get(ctx, { itemId: asItemId(snapshot.itemId) }).catch(() => null);
  const urls = snapshot.attachments.map((attachment, index) => ({ kind: attachment.kind, url: attachmentUrls[index] ?? null }));
  return {
    number: typeof item?.number === "number" ? item.number : null,
    title: snapshot.title,
    description: snapshot.description,
    transcript: snapshot.transcript ?? null,
    screenshots: urls.filter((a) => a.kind === "screenshot" && a.url).map((a) => a.url!),
    audioUrl: urls.find((a) => a.kind === "audio" && a.url)?.url ?? null,
  };
}

/**
 * A request is waiting for Mike: snapshot it as the admin and make its
 * Approve and Reject links. The tokens go back to the emailing action only.
 */
export const createRequestLinks = internalMutation({
  args: { itemId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ approveToken: v.string(), rejectToken: v.string(), request: vRequest }),
  ),
  handler: async (ctx, { itemId }) => {
    const item = await feedback.items.get(ctx, { itemId: asItemId(itemId) }).catch(() => null);
    if (!item || item.state !== "submitted") return null;
    const { snapshotId, contentHash } = await feedback.chefSnapshots.prepareApproval(ctx, { itemId, adminUserId: CHEF_ADMIN_ID });
    const request = await snapshotRequest(ctx, snapshotId);
    if (!request) return null;
    const approveToken = await insertLink(ctx, { action: "approve", itemId, snapshotId, contentHash });
    const rejectToken = await insertLink(ctx, { action: "reject", itemId });
    return { approveToken, rejectToken, request };
  },
});

/** A build is ready: its Ship it link. */
export const createShipLink = internalMutation({
  args: { runId: v.string() },
  returns: v.string(),
  handler: async (ctx, { runId }) => await insertLink(ctx, { action: "ship", runId }),
});

async function shipView(ctx: QueryCtx, runId: string): Promise<LinkShip> {
  const candidate = await ctx.runQuery(components.feedback.chefShip.candidate, { viewer: CHEF_ADMIN_ID }).catch(() => null);
  const run = await ctx.runQuery(components.feedback.chefRuns.lookup, { viewer: CHEF_ADMIN_ID, runId }).catch(() => null);
  const isCandidate = candidate?.run?.runId !== undefined && String(candidate.run.runId) === runId;
  const diff = isCandidate ? candidate!.run!.diff : null;
  let blocked: string | null = null;
  if (!run) blocked = "Chef has no build with this id.";
  else if (run.status !== "built") blocked = `This build isn't ready to ship (it's ${run.status}).`;
  else if (!isCandidate) blocked = "A newer build has replaced this one. Use the newest email's Ship it, or the Chef panel.";
  else if (candidate!.blocked) blocked = candidate!.blocked;
  else if (!diff) blocked = "Chef hasn't worked out this build's changes yet. Try again in a minute.";
  return {
    runId,
    seq: run?.seq ?? null,
    requests: isCandidate ? candidate!.requests.map((r) => `${r.number !== null ? `#${r.number} ` : ""}${r.title}`) : [],
    previewUrl: run?.previewUrl ?? null,
    diffHash: diff?.diffHash ?? null,
    depsChanged: diff?.depsChanged ?? false,
    filesChanged: diff?.filesChanged ?? [],
    blocked,
  };
}

/** The page's GET: what the link would do. Reads only. */
export const view = internalQuery({
  args: { tokenHash: v.string() },
  returns: v.any(),
  handler: async (ctx, { tokenHash }): Promise<LinkView> => {
    const link = await findLink(ctx, tokenHash);
    if (!link) return { state: "unknown" };
    const check = checkLink(link, link.action, Date.now());
    if (!check.ok && check.reason === "used") return { state: "used", action: link.action, outcome: link.outcome ?? "" };
    if (!check.ok) return { state: "expired", action: link.action };
    if (link.action === "ship") return { state: "open", action: "ship", ship: await shipView(ctx, link.runId!) };
    const request = link.snapshotId
      ? await snapshotRequest(ctx, link.snapshotId)
      : await itemRequest(ctx, link.itemId!);
    if (!request) return { state: "unknown" };
    return { state: "open", action: link.action, request };
  },
});

async function itemRequest(ctx: QueryCtx, itemId: string): Promise<LinkRequest | null> {
  const item = await feedback.items.get(ctx, { itemId: asItemId(itemId) }).catch(() => null);
  if (!item) return null;
  const [media] = await feedback.attachments.listForItems(ctx, { itemIds: [itemId], viewer: CHEF_ADMIN_ID }).catch(() => []);
  const attachments = media?.attachments ?? [];
  return {
    number: typeof item.number === "number" ? item.number : null,
    title: String(item.title ?? ""),
    description: String(item.description ?? ""),
    transcript: typeof item.transcript === "string" ? item.transcript : null,
    screenshots: attachments.filter((a) => a.kind === "screenshot" && a.url).map((a) => a.url!),
    audioUrl: attachments.find((a) => a.kind === "audio" && a.url)?.url ?? null,
  };
}

function failure(error: unknown) {
  return String((error as Error)?.message ?? error)
    .replace(/^[\s\S]*?Uncaught Error: /, "")
    .split("\n")[0];
}

// One request's other link is spent once either is used: approving a
// request it was offered to reject (or the other way round) can't happen later.
async function retireSiblings(ctx: MutationCtx, link: Doc<"chefLinks">, outcome: string) {
  if (!link.itemId) return;
  const siblings = await ctx.db
    .query("chefLinks")
    .withIndex("by_item_id", (q) => q.eq("itemId", link.itemId))
    .take(20);
  for (const sibling of siblings) {
    if (sibling._id !== link._id && sibling.usedAt === undefined) {
      await ctx.db.patch("chefLinks", sibling._id, { usedAt: Date.now(), outcome });
    }
  }
}

/**
 * The page's POST: check the link again, act on Chef as the admin, and spend
 * the link, all in this one transaction. A refused action leaves the link
 * unused, so it can be tried again while it's valid.
 */
export const use = internalMutation({
  args: {
    tokenHash: v.string(),
    action: v.string(),
    diffHash: v.optional(v.string()),
    depsAcknowledged: v.optional(v.boolean()),
  },
  returns: v.object({ ok: v.boolean(), message: v.string() }),
  handler: async (ctx, args): Promise<LinkResult> => {
    const link = await findLink(ctx, args.tokenHash);
    const check = checkLink(link, args.action, Date.now());
    if (!check.ok || !link || !isLinkAction(args.action)) {
      const reason = check.ok ? "wrongAction" : check.reason;
      if (reason === "used") return { ok: false, message: `This link has already been used. ${link?.outcome ?? ""}`.trim() };
      if (reason === "expired") return { ok: false, message: "This link has expired. Links in Chef's emails last 7 days." };
      if (reason === "wrongAction") return { ok: false, message: "This link can't do that." };
      return { ok: false, message: "This link isn't one Cannvas made." };
    }

    let outcome: string;
    try {
      if (link.action === "approve") {
        await feedback.chefSnapshots.approve(ctx, {
          snapshotId: link.snapshotId!,
          contentHash: link.contentHash!,
          adminUserId: CHEF_ADMIN_ID,
        });
        const builds = await ctx.runQuery(components.feedback.chefRuns.buildState, { viewer: CHEF_ADMIN_ID }).catch(() => null);
        outcome = builds?.cloudEnabled
          ? "Approved. Chef is building it, and emails you when it's ready to check."
          : "Approved. Cloud builds are off, so Chef will build it once they're on.";
      } else if (link.action === "reject") {
        await feedback.items.review(ctx, { itemId: asItemId(link.itemId!), approve: false, reviewerId: CHEF_ADMIN_ID });
        outcome = "Rejected.";
      } else {
        if (!args.diffHash) return { ok: false, message: "Open the link from the email and press Ship it there." };
        const ship = await shipView(ctx, link.runId!);
        if (ship.blocked) return { ok: false, message: ship.blocked };
        if (ship.diffHash !== args.diffHash) {
          return { ok: false, message: "This build changed since the page was opened. Open the link again." };
        }
        const result = await ctx.runMutation(components.feedback.chefShip.approve, {
          adminUserId: CHEF_ADMIN_ID,
          runId: link.runId!,
          diffHash: args.diffHash,
          ...(args.depsAcknowledged ? { depsAcknowledged: true } : {}),
        });
        if (!result.approved) return { ok: false, message: result.reason ?? "Chef wouldn't ship this build." };
        outcome = `Shipping${result.seq !== undefined ? ` release ${result.seq}` : ""}. Chef emails you when it's live. Then run deploy/ship-from-chef.sh to put it on the wall.`;
      }
    } catch (error) {
      return { ok: false, message: `Chef refused: ${failure(error)}` };
    }
    await ctx.db.patch("chefLinks", link._id, { usedAt: Date.now(), outcome });
    await retireSiblings(ctx, link, link.action === "approve" ? "The request was approved." : "The request was rejected.");
    return { ok: true, message: outcome };
  },
});
