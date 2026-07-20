import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const COLORS = ["#ff8066", "#ffbf47", "#5ec6a5", "#6ba7ff", "#a77bea", "#ff7eb3"];

export const list = query({
  args: {},
  handler: async (ctx) => {
    const chores = await ctx.db.query("chores").withIndex("by_position").collect();
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
  },
});

export const listCompletions = query({
  args: {},
  handler: async (ctx) => {
    const completions = await ctx.db.query("choreCompletions").collect();
    return completions.map(({ choreId, date }) => ({ choreId, date }));
  },
});

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("chores").first();
    if (existing) return;
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
  },
});

export const add = mutation({
  args: {
    name: v.string(),
    valueCents: v.number(),
    category: v.union(v.literal("standard"), v.literal("bonus")),
  },
  handler: async (ctx, args) => {
    const active = (await ctx.db.query("chores").collect()).filter((chore) => chore.active);
    return await ctx.db.insert("chores", {
      name: args.name.trim(),
      valueCents: Math.max(0, Math.round(args.valueCents)),
      category: args.category,
      color: COLORS[active.length % COLORS.length],
      position: active.length,
      active: true,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("chores"),
    name: v.string(),
    valueCents: v.number(),
    category: v.union(v.literal("standard"), v.literal("bonus")),
  },
  handler: async (ctx, { id, name, valueCents, category }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Chore name cannot be empty");
    await ctx.db.patch(id, {
      name: trimmed,
      valueCents: Math.max(0, Math.round(valueCents)),
      category,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("chores") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { active: false });
  },
});

export const toggleCompletion = mutation({
  args: { choreId: v.id("chores"), date: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("choreCompletions")
      .withIndex("by_chore_date", (q) => q.eq("choreId", args.choreId).eq("date", args.date))
      .unique();
    if (existing) return await ctx.db.delete(existing._id);
    return await ctx.db.insert("choreCompletions", { ...args, completedAt: Date.now() });
  },
});

export const clearWeek = mutation({
  args: { weekStart: v.string() },
  handler: async (ctx, { weekStart }) => {
    const start = new Date(`${weekStart}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const completions = await ctx.db.query("choreCompletions").collect();
    await Promise.all(
      completions
        .filter(({ date }) => {
          const value = new Date(`${date}T00:00:00`);
          return value >= start && value < end;
        })
        .map(({ _id }) => ctx.db.delete(_id)),
    );
  },
});
