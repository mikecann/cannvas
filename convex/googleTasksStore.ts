import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const connection = v.object({
  refreshToken: v.string(),
  accessToken: v.optional(v.string()),
  accessTokenExpiresAt: v.optional(v.number()),
  mumListId: v.optional(v.string()),
  dadListId: v.optional(v.string()),
  joshListId: v.optional(v.string()),
  lastPolledAt: v.optional(v.number()),
});

export const getConnection = internalQuery({
  args: {},
  returns: v.union(v.null(), connection),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("googleTasksConnections")
      .withIndex("by_key", (q) => q.eq("key", "primary"))
      .unique();
    if (!row) return null;
    return {
      refreshToken: row.refreshToken,
      accessToken: row.accessToken,
      accessTokenExpiresAt: row.accessTokenExpiresAt,
      mumListId: row.mumListId,
      dadListId: row.dadListId,
      joshListId: row.joshListId,
      lastPolledAt: row.lastPolledAt,
    };
  },
});

export const saveConnection = internalMutation({
  args: {
    refreshToken: v.optional(v.string()),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleTasksConnections")
      .withIndex("by_key", (q) => q.eq("key", "primary"))
      .unique();
    if (!existing && !args.refreshToken) {
      throw new Error("Google did not return a refresh token");
    }
    if (existing) {
      await ctx.db.patch(existing._id, {
        refreshToken: args.refreshToken ?? existing.refreshToken,
        accessToken: args.accessToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("googleTasksConnections", {
        key: "primary",
        refreshToken: args.refreshToken!,
        accessToken: args.accessToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const saveAccessToken = internalMutation({
  args: {
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleTasksConnections")
      .withIndex("by_key", (q) => q.eq("key", "primary"))
      .unique();
    if (!existing) throw new Error("Google Tasks is not connected");
    await ctx.db.patch(existing._id, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const saveListIds = internalMutation({
  args: {
    mumListId: v.string(),
    dadListId: v.string(),
    joshListId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleTasksConnections")
      .withIndex("by_key", (q) => q.eq("key", "primary"))
      .unique();
    if (!existing) throw new Error("Google Tasks is not connected");
    await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
    return null;
  },
});

export const saveLastPolledAt = internalMutation({
  args: { lastPolledAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("googleTasksConnections")
      .withIndex("by_key", (q) => q.eq("key", "primary"))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastPolledAt: args.lastPolledAt,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const createOAuthState = internalMutation({
  args: {
    state: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("googleTasksOAuthStates", args);
    return null;
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("googleTasksOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) return false;
    await ctx.db.delete(row._id);
    return row.expiresAt >= Date.now();
  },
});
