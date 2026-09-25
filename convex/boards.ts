import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { deviceMutation, deviceQuery } from "./fluent";
import { stroke } from "./lib/validators";

// The original remote-first whiteboard table. The kiosk now keeps boards on
// the device and backs them up to deviceBoards, so this is only read when a
// kiosk with no local data and no device backup needs to recover.
export const list = deviceQuery
  .input({ paginationOpts: paginationOptsValidator })
  .returns(v.object({
    page: v.array(v.object({ date: v.string(), strokes: v.array(stroke), updatedAt: v.number() })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }))
  .handler(async (ctx, args) => {
    const result = await ctx.db
      .query("boards")
      .withIndex("by_date")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page.map(({ date, strokes, updatedAt }) => ({ date, strokes, updatedAt })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  })
  .public();

export const save = deviceMutation
  .input({ date: v.string(), strokes: v.array(stroke) })
  .returns(v.id("boards"))
  .handler(async (ctx, args) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new ConvexError("Board date must use YYYY-MM-DD.");
    const existing = await ctx.db
      .query("boards")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .unique();
    const value = { strokes: args.strokes, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("boards", { date: args.date, ...value });
  })
  .public();
