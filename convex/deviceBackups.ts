import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const backup = await ctx.db
      .query("deviceBackups")
      .withIndex("by_device_id", (q) => q.eq("deviceId", deviceId))
      .unique();
    if (!backup) return null;
    return { revision: backup.revision, state: backup.state, updatedAt: backup.updatedAt };
  },
});

export const save = mutation({
  args: {
    deviceId: v.string(),
    revision: v.number(),
    state: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("deviceBackups")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .unique();

    // Rapid edits can leave several requests in flight. Never let an older
    // response arrive late and replace a newer device snapshot.
    if (existing && args.revision <= existing.revision) {
      return { accepted: false, revision: existing.revision };
    }

    const value = { revision: args.revision, state: args.state, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("deviceBackups", { deviceId: args.deviceId, ...value });
    return { accepted: true, revision: args.revision };
  },
});
