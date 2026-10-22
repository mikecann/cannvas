// Chef's emails to Mike, all through Chef's bundled Resend (gateway mode:
// the deployment's own service token, billed to the Convex team, no Resend
// account). `from` must be on a sending domain the team verified through
// the gateway (README, "Chef emails").
import type { ChefSend } from "@convex-dev/chef-cloud";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { builtRunId, linkUrl, requestEmail, requestEmailKey, withShipButton } from "./lib/chefLinks";

export const CHEF_OWNER_EMAIL = "mike.cann@gmail.com";
const DEFAULT_FROM = "Cannvas <chef@mail.mikecann.app>";

function siteUrl() {
  const url = process.env.CONVEX_SITE_URL;
  if (!url) throw new Error("CONVEX_SITE_URL is not set");
  return url;
}

async function send(ctx: ActionCtx, email: { to: string; subject: string; html: string; text: string; idempotencyKey: string }) {
  const id = await ctx.runMutation(components.chefCloud.providers.sendEmail, {
    from: process.env.CHEF_EMAIL_FROM?.trim() || DEFAULT_FROM,
    to: email.to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: email.idempotencyKey,
  });
  return { id };
}

/**
 * chefCloud's notify.send: Chef's own emails, with Ship it added to "built".
 * Chef sends each run's "built" email once, keyed `chef-<runId>-built`, and
 * only calls this again to retry that same send, so the key stays Chef's: a
 * retry Resend deduplicates leaves the first email's Ship it link (still
 * valid) in the inbox, and the retry's link is never delivered or used.
 */
export const chefNotifySend: ChefSend = async (ctx, email) => {
  const runId = email.kind === "built" ? builtRunId(email.idempotencyKey) : null;
  if (!runId) return await send(ctx, email);
  const token = await ctx.runMutation(internal.chefLinks.createShipLink, { runId });
  return await send(ctx, { ...email, ...withShipButton(email, linkUrl(siteUrl(), token)) });
};

/**
 * A request is waiting for Mike: email it with Approve and build, and Reject.
 * Each run is a new email with new links, so this is also how to resend one.
 */
export const sendRequestEmail = internalAction({
  args: { itemId: v.string() },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    const links = await ctx.runMutation(internal.chefLinks.createRequestLinks, { itemId });
    if (!links) return null;
    const email = requestEmail({
      request: links.request,
      approveUrl: linkUrl(siteUrl(), links.approveToken),
      rejectUrl: linkUrl(siteUrl(), links.rejectToken),
    });
    const { id } = await send(ctx, { to: CHEF_OWNER_EMAIL, ...email, idempotencyKey: requestEmailKey(itemId, links.deliveryId) });
    console.log(`Chef: emailed request ${itemId} to the owner (${id})`);
    return null;
  },
});
