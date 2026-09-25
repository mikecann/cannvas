import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { deviceMutation, deviceQuery } from "./fluent";
import { choreCategory } from "./lib/validators";

// The kiosk keeps chores on the device and backs them up with deviceBackups.
// These tables are the original remote-first store, still read when a kiosk
// with no local data and no device backup needs to recover.

const COLORS = ["#ff8066", "#ffbf47", "#5ec6a5", "#6ba7ff", "#a77bea", "#ff7eb3"];
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHORES = 200;

function cleanName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("Chore name cannot be empty");
  return trimmed.slice(0, 200);
}

function cleanValue(valueCents: number) {
  return Number.isFinite(valueCents) ? Math.max(0, Math.round(valueCents)) : 0;
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const list = deviceQuery
  .input({})
  .returns(v.array(v.object({
    _id: v.id("chores"),
    id: v.id("chores"),
    name: v.string(),
    valueCents: v.number(),
    category: choreCategory,
    color: v.string(),
    position: v.number(),
  })))
  .handler(async (ctx) => {
    const chores = await ctx.db.query("chores").withIndex("by_position").take(MAX_CHORES);
    return chores
      .filter((chore) => chore.active)
      .map(({ _id, name, valueCents, category, color, position }) => ({
        _id,
        id: _id,
        name,
        valueCents,
        category: category ?? "standard",
        color,
        position,
      }));
  })
  .public();

export const listCompletions = deviceQuery
  .input({ paginationOpts: paginationOptsValidator })
  .returns(v.object({
    page: v.array(v.object({ choreId: v.id("chores"), date: v.string() })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }))
  .handler(async (ctx, args) => {
    const result = await ctx.db
      .query("choreCompletions")
      .withIndex("by_date")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page.map(({ choreId, date }) => ({ choreId, date })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  })
  .public();

export const seed = deviceMutation
  .input({})
  .returns(v.null())
  .handler(async (ctx) => {
    const existing = await ctx.db.query("chores").first();
    if (existing) return null;
    const defaults = [
      ["Make my bed", 50],
      ["Feed the pets", 50],
      ["Tidy my room", 100],
    ] as const;
    for (const [position, [name, valueCents]] of defaults.entries()) {
      await ctx.db.insert("chores", {
        name,
        valueCents,
        category: "standard",
        color: COLORS[position],
        position,
        active: true,
      });
    }
    return null;
  })
  .public();

export const add = deviceMutation
  .input({
    name: v.string(),
    valueCents: v.number(),
    category: choreCategory,
  })
  .returns(v.id("chores"))
  .handler(async (ctx, args) => {
    const name = cleanName(args.name);
    const active = (await ctx.db.query("chores").withIndex("by_position").take(MAX_CHORES))
      .filter((chore) => chore.active);
    if (active.length >= MAX_CHORES) throw new ConvexError("There are too many chores.");
    const lastPosition = active.reduce((highest, chore) => Math.max(highest, chore.position), -1);
    return await ctx.db.insert("chores", {
      name,
      valueCents: cleanValue(args.valueCents),
      category: args.category,
      color: COLORS[active.length % COLORS.length],
      position: lastPosition + 1,
      active: true,
    });
  })
  .public();

export const update = deviceMutation
  .input({
    id: v.id("chores"),
    name: v.string(),
    valueCents: v.number(),
    category: choreCategory,
  })
  .returns(v.null())
  .handler(async (ctx, args) => {
    await ctx.db.patch(args.id, {
      name: cleanName(args.name),
      valueCents: cleanValue(args.valueCents),
      category: args.category,
    });
    return null;
  })
  .public();

export const remove = deviceMutation
  .input({ id: v.id("chores") })
  .returns(v.null())
  .handler(async (ctx, args) => {
    await ctx.db.patch(args.id, { active: false });
    return null;
  })
  .public();

export const toggleCompletion = deviceMutation
  .input({ choreId: v.id("chores"), date: v.string() })
  .returns(v.null())
  .handler(async (ctx, args) => {
    if (!DATE_KEY.test(args.date)) throw new ConvexError("Date must use YYYY-MM-DD.");
    const existing = await ctx.db
      .query("choreCompletions")
      .withIndex("by_chore_date", (q) => q.eq("choreId", args.choreId).eq("date", args.date))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    else await ctx.db.insert("choreCompletions", { choreId: args.choreId, date: args.date, completedAt: Date.now() });
    return null;
  })
  .public();

export const clearWeek = deviceMutation
  .input({ weekStart: v.string() })
  .returns(v.null())
  .handler(async (ctx, args) => {
    if (!DATE_KEY.test(args.weekStart)) throw new ConvexError("Week start must use YYYY-MM-DD.");
    const weekEnd = addDaysToDateKey(args.weekStart, 7);
    const completions = await ctx.db
      .query("choreCompletions")
      .withIndex("by_date", (q) => q.gte("date", args.weekStart).lt("date", weekEnd))
      .take(1000);
    await Promise.all(completions.map(({ _id }) => ctx.db.delete(_id)));
    return null;
  })
  .public();
