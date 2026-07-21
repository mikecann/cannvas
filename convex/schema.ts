import { defineSchema, defineTable } from "convex/server";
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

export default defineSchema({
  deviceBackups: defineTable({
    deviceId: v.string(),
    revision: v.number(),
    state: v.any(),
    updatedAt: v.number(),
  }).index("by_device_id", ["deviceId"]),
  boards: defineTable({
    date: v.string(),
    strokes: v.array(stroke),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),
  chores: defineTable({
    name: v.string(),
    valueCents: v.number(),
    // Optional keeps existing production chores valid; the app treats missing as Standard.
    category: v.optional(v.union(v.literal("standard"), v.literal("bonus"))),
    color: v.string(),
    position: v.number(),
    active: v.boolean(),
  }).index("by_position", ["position"]),
  choreCompletions: defineTable({
    choreId: v.id("chores"),
    date: v.string(),
    completedAt: v.number(),
  })
    .index("by_chore_date", ["choreId", "date"])
    .index("by_date", ["date"]),
});
