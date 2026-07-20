import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const point = v.object({ x: v.number(), y: v.number() });
const stroke = v.object({
  id: v.string(),
  color: v.string(),
  width: v.number(),
  points: v.array(point),
});

export default defineSchema({
  boards: defineTable({
    date: v.string(),
    strokes: v.array(stroke),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),
  chores: defineTable({
    name: v.string(),
    valueCents: v.number(),
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
