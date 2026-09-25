import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";
import {
  choreCategory,
  inventoryEnrichmentStatus,
  inventoryEventType,
  inventoryRole,
  inventoryStatus,
  stroke,
  todoAssignee,
  todoPriority,
  todoSyncState,
} from "./lib/validators";

export default defineSchema({
  ...authTables,
  deviceBackups: defineTable({
    deviceId: v.string(),
    revision: v.number(),
    // Older kiosk builds stored the whole device, whiteboards included, in
    // this one document. Newer builds store a validated deviceState without
    // boards. Saving in the new format moves any inline boards to deviceBoards.
    state: v.any(),
    updatedAt: v.number(),
  }).index("by_device_id", ["deviceId"]),
  deviceBoards: defineTable({
    deviceId: v.string(),
    date: v.string(),
    revision: v.number(),
    strokes: v.array(stroke),
    updatedAt: v.number(),
  }).index("by_device_id_and_date", ["deviceId", "date"]),
  boards: defineTable({
    date: v.string(),
    strokes: v.array(stroke),
    updatedAt: v.number(),
  }).index("by_date", ["date"]),
  chores: defineTable({
    name: v.string(),
    valueCents: v.number(),
    // Optional keeps existing production chores valid; the app treats missing as Standard.
    category: v.optional(choreCategory),
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
    // Failed pushes back off instead of retrying every poll.
    syncAttempts: v.optional(v.number()),
    nextSyncAt: v.optional(v.number()),
    // Only one pushTodo run may talk to Google for a to-do at a time, or two
    // overlapping runs can both create the Google task.
    syncLeaseId: v.optional(v.string()),
    syncLeaseUntil: v.optional(v.number()),
  })
    .index("by_deleted_at_and_created_at", ["deletedAt", "createdAt"])
    .index("by_legacy_id", ["legacyId"])
    .index("by_sync_state", ["syncState"])
    .index("by_sync_state_and_next_sync_at", ["syncState", "nextSyncAt"])
    .index("by_google_task_list_id_and_google_task_id", ["googleTaskListId", "googleTaskId"]),
  googleTasksConnections: defineTable({
    key: v.string(),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
    mumListId: v.optional(v.string()),
    dadListId: v.optional(v.string()),
    joshListId: v.optional(v.string()),
    // When dadListId was last confirmed by title. Pushes only trust a
    // recently confirmed ID.
    dadListCheckedAt: v.optional(v.number()),
    lastPolledAt: v.optional(v.number()),
    // Where a poll that hit the page limit stopped. The next poll resumes
    // here instead of starting again at page one.
    pollCursor: v.optional(v.object({
      pageToken: v.string(),
      updatedMin: v.optional(v.string()),
      startedAt: v.number(),
    })),
    lastPollError: v.optional(v.string()),
    lastPollErrorAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  googleTasksOAuthStates: defineTable({
    state: v.string(),
    expiresAt: v.number(),
  }).index("by_state", ["state"]),
  inventoryAccess: defineTable({
    userId: v.id("users"),
    role: inventoryRole,
    grantedAt: v.number(),
  }).index("by_user_id", ["userId"]),
  inventoryLocations: defineTable({
    name: v.string(),
    normalizedName: v.string(),
    usageCount: v.number(),
    lastUsedAt: v.number(),
    archived: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_normalized_name", ["normalizedName"])
    .index("by_archived_and_usage_count", ["archived", "usageCount"])
    .index("by_archived_and_last_used_at", ["archived", "lastUsedAt"]),
  inventoryItems: defineTable({
    title: v.string(),
    description: v.string(),
    category: v.string(),
    tags: v.array(v.string()),
    condition: v.string(),
    quantity: v.number(),
    attributes: v.array(v.object({ label: v.string(), value: v.string() })),
    currentLocationId: v.id("inventoryLocations"),
    currentLocationName: v.string(),
    status: inventoryStatus,
    enrichmentStatus: inventoryEnrichmentStatus,
    // Optional because production already contains inventory rows from the
    // first deployment. New writes always set both counters.
    enrichmentGeneration: v.optional(v.number()),
    manualEditVersion: v.optional(v.number()),
    enrichmentError: v.optional(v.string()),
    aiModel: v.optional(v.string()),
    aiSources: v.array(v.object({ title: v.string(), url: v.string() })),
    searchText: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
    removedAt: v.optional(v.number()),
  })
    .index("by_updated_at", ["updatedAt"])
    .index("by_status_and_updated_at", ["status", "updatedAt"])
    .index("by_current_location_id_and_updated_at", ["currentLocationId", "updatedAt"])
    .index("by_current_location_id_and_status_and_updated_at", [
      "currentLocationId",
      "status",
      "updatedAt",
    ])
    .searchIndex("search_inventory", {
      searchField: "searchText",
      filterFields: ["status", "category", "currentLocationId"],
    }),
  inventoryPhotos: defineTable({
    itemId: v.id("inventoryItems"),
    storageId: v.id("_storage"),
    sortOrder: v.number(),
    capturedAt: v.number(),
    addedBy: v.id("users"),
  }).index("by_item_id_and_sort_order", ["itemId", "sortOrder"]),
  inventoryEvents: defineTable({
    itemId: v.id("inventoryItems"),
    type: inventoryEventType,
    actorId: v.optional(v.id("users")),
    fromLocationId: v.optional(v.id("inventoryLocations")),
    fromLocationName: v.optional(v.string()),
    toLocationId: v.optional(v.id("inventoryLocations")),
    toLocationName: v.optional(v.string()),
    note: v.optional(v.string()),
    occurredAt: v.number(),
  }).index("by_item_id_and_occurred_at", ["itemId", "occurredAt"]),
});
