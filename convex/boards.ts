import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const point = v.object({ x: v.number(), y: v.number() });
const stroke = v.object({
  id: v.string(),
  kind: v.optional(v.union(v.literal("stroke"), v.literal("sticker"))),
  color: v.string(),
  width: v.number(),
  points: v.array(point),
  sticker: v.optional(v.string()),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const boards = await ctx.db.query("boards").collect();
    return boards.map(({ date, strokes, updatedAt }) => ({ date, strokes, updatedAt }));
  },
});

export const save = mutation({
  args: { date: v.string(), strokes: v.array(stroke) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("boards")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .unique();
    const value = { strokes: args.strokes, updatedAt: Date.now() };
    if (existing) return await ctx.db.patch(existing._id, value);
    return await ctx.db.insert("boards", { date: args.date, ...value });
  },
});
