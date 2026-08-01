import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const grant = internalMutation({
  args: { userId: v.id("users") },
  returns: v.object({ role: v.union(v.literal("owner"), v.literal("member")) }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("inventoryAccess")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .unique();
    if (existing) return { role: existing.role };

    const isFirstGrant = (await ctx.db.query("inventoryAccess").take(1)).length === 0;
    const role: "owner" | "member" = isFirstGrant ? "owner" : "member";
    await ctx.db.insert("inventoryAccess", {
      userId: args.userId,
      role,
      grantedAt: Date.now(),
    });
    return { role };
  },
});
