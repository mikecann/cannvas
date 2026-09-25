import { v } from "convex/values";

export const point = v.object({ x: v.number(), y: v.number() });
export const stroke = v.object({
  id: v.string(),
  kind: v.optional(v.union(v.literal("stroke"), v.literal("sticker"))),
  color: v.string(),
  width: v.number(),
  points: v.array(point),
  sticker: v.optional(v.string()),
});

export const choreCategory = v.union(v.literal("standard"), v.literal("bonus"));

export const todoAssignee = v.union(v.literal("mum"), v.literal("dad"), v.literal("josh"));
export const todoPriority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
export const todoSyncState = v.union(v.literal("pending"), v.literal("synced"), v.literal("error"));

export const inventoryStatus = v.union(
  v.literal("active"),
  v.literal("disposed"),
  v.literal("donated"),
  v.literal("sold"),
  v.literal("lost"),
);
export const inventoryEnrichmentStatus = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
);
export const inventoryEventType = v.union(
  v.literal("added"),
  v.literal("edited"),
  v.literal("moved"),
  v.literal("photo_added"),
  v.literal("ai_enriched"),
  v.literal("ai_failed"),
  v.literal("disposed"),
  v.literal("donated"),
  v.literal("sold"),
  v.literal("lost"),
  v.literal("restored"),
);
export const inventoryRole = v.union(v.literal("owner"), v.literal("member"));

// The kiosk's device backup, minus whiteboards. Boards are stored one document
// per date in deviceBoards so no single document can outgrow Convex's limit.
export const deviceChore = v.object({
  id: v.string(),
  name: v.string(),
  valueCents: v.number(),
  category: choreCategory,
  color: v.string(),
  position: v.number(),
});
export const deviceCompletion = v.object({ choreId: v.string(), date: v.string() });
export const deviceTodo = v.object({
  id: v.string(),
  title: v.string(),
  assignee: todoAssignee,
  priority: todoPriority,
  dueDate: v.optional(v.string()),
  completed: v.boolean(),
  createdAt: v.number(),
});
export const deviceTabletSchedule = v.object({
  id: v.string(),
  name: v.string(),
  purpose: v.string(),
  cadenceMonths: v.number(),
  color: v.string(),
  dueDate: v.optional(v.string()),
});
export const deviceTabletCompletion = v.object({
  id: v.string(),
  tabletId: v.string(),
  takenDate: v.string(),
  previousDueDate: v.optional(v.string()),
});
export const deviceState = v.object({
  version: v.literal(3),
  tabletScheduleVersion: v.number(),
  revision: v.number(),
  updatedAt: v.number(),
  chores: v.array(deviceChore),
  completions: v.array(deviceCompletion),
  todos: v.array(deviceTodo),
  tabletSchedules: v.array(deviceTabletSchedule),
  tabletCompletions: v.array(deviceTabletCompletion),
});
