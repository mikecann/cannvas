import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

async function grantAccess(ctx: GenericMutationCtx<DataModel>, userId: Id<"users">) {
  const existing = await ctx.db
    .query("inventoryAccess")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();
  if (existing) return { role: existing.role };

  const isFirstGrant = (await ctx.db.query("inventoryAccess").take(1)).length === 0;
  const role: "owner" | "member" = isFirstGrant ? "owner" : "member";
  await ctx.db.insert("inventoryAccess", {
    userId,
    role,
    grantedAt: Date.now(),
  });
  return { role };
}

export const grant = internalMutation({
  args: { userId: v.id("users") },
  returns: v.object({ role: v.union(v.literal("owner"), v.literal("member")) }),
  handler: async (ctx, args) => grantAccess(ctx, args.userId),
});

export const grantByEmail = internalMutation({
  args: { email: v.string() },
  returns: v.object({ role: v.union(v.literal("owner"), v.literal("member")) }),
  handler: async (ctx, args) => {
    const email = args.email.trim().toLocaleLowerCase("en-AU");
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (!user) throw new Error(`No Cannvas account exists for ${email}. Ask them to create an account first.`);
    return grantAccess(ctx, user._id);
  },
});
