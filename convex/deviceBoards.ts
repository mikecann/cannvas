import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { assertBackupSize, assertRevision, storedRevision } from "./deviceBackups";
import { deviceMutation, deviceQuery } from "./fluent";
import { stroke } from "./lib/validators";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const board = v.object({ date: v.string(), revision: v.number(), strokes: v.array(stroke) });

// One document per whiteboard date keeps each backup write small and far
// below Convex's per-document limit, however many boards the family keeps.
export const save = deviceMutation
  .input({
    deviceId: v.string(),
    date: v.string(),
    revision: v.number(),
    strokes: v.array(stroke),
  })
  .returns(v.object({ accepted: v.boolean(), revision: v.number() }))
  .handler(async (ctx, args) => {
    if (!DATE_KEY.test(args.date)) throw new ConvexError("Board date must use YYYY-MM-DD.");
    assertRevision(args.revision);
    assertBackupSize(args.strokes, `The ${args.date} whiteboard`);
    const existing = await ctx.db
      .query("deviceBoards")
      .withIndex("by_device_id_and_date", (q) => q.eq("deviceId", args.deviceId).eq("date", args.date))
      .unique();
    if (existing && args.revision <= storedRevision(existing.revision)) {
      return { accepted: false, revision: existing.revision };
    }
    const value = { revision: args.revision, strokes: args.strokes, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("deviceBoards", { deviceId: args.deviceId, date: args.date, ...value });
    return { accepted: true, revision: args.revision };
  })
  .public();

// Which boards the server holds, and at what revision. The kiosk checks this
// on startup so a lost or restored table can't hide boards that need upload.
export const revisions = deviceQuery
  .input({ deviceId: v.string(), paginationOpts: paginationOptsValidator })
  .returns(v.object({
    page: v.array(v.object({ date: v.string(), revision: v.number() })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }))
  .handler(async (ctx, args) => {
    const result = await ctx.db
      .query("deviceBoards")
      .withIndex("by_device_id_and_date", (q) => q.eq("deviceId", args.deviceId))
      .paginate(args.paginationOpts);
    return {
      page: result.page.map(({ date, revision }) => ({ date, revision })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  })
  .public();

// Only used to rebuild a kiosk that has lost its local storage.
export const page = deviceQuery
  .input({ deviceId: v.string(), paginationOpts: paginationOptsValidator })
  .returns(v.object({ page: v.array(board), isDone: v.boolean(), continueCursor: v.string() }))
  .handler(async (ctx, args) => {
    const result = await ctx.db
      .query("deviceBoards")
      .withIndex("by_device_id_and_date", (q) => q.eq("deviceId", args.deviceId))
      .paginate(args.paginationOpts);
    return {
      page: result.page.map(({ date, revision, strokes }) => ({ date, revision, strokes })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  })
  .public();
