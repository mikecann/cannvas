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
const todoAssignee = v.union(v.literal("mum"), v.literal("dad"), v.literal("josh"));
const todoPriority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
const todoSyncState = v.union(v.literal("pending"), v.literal("synced"), v.literal("error"));

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
  todos: defineTable({
    title: v.string(),
    assignee: todoAssignee,
    priority: todoPriority,
    dueDate: v.optional(v.string()),
    completed: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    legacyId: v.optional(v.string()),
    googleTaskId: v.optional(v.string()),
    googleTaskListId: v.optional(v.string()),
    googleUpdatedAt: v.optional(v.string()),
    syncState: v.optional(todoSyncState),
    syncError: v.optional(v.string()),
  })
    .index("by_deleted_at_and_created_at", ["deletedAt", "createdAt"])
    .index("by_legacy_id", ["legacyId"])
    .index("by_sync_state", ["syncState"])
    .index("by_google_task_list_id_and_google_task_id", ["googleTaskListId", "googleTaskId"]),
  googleTasksConnections: defineTable({
    key: v.string(),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    mumListId: v.optional(v.string()),
    dadListId: v.optional(v.string()),
    joshListId: v.optional(v.string()),
    lastPolledAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  googleTasksOAuthStates: defineTable({
    state: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
});
