import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { deviceMutation, deviceQuery } from "./fluent";
import { syncBackoffMs } from "./lib/backoff";
import { todoAssignee as assignee, todoPriority as priority } from "./lib/validators";

// A push that dies mid-flight releases its claim after this long.
const SYNC_LEASE_MS = 2 * 60_000;

function isWaitingForRetry(row: Doc<"todos">, now: number) {
  return row.syncState === "error" && (row.nextSyncAt ?? 0) > now;
}

const todo = v.object({
  id: v.id("todos"),
  title: v.string(),
  assignee,
  priority,
  dueDate: v.optional(v.string()),
  completed: v.boolean(),
  createdAt: v.number(),
});

const legacyTodo = v.object({
  id: v.string(),
  title: v.string(),
  assignee,
  priority,
  dueDate: v.optional(v.string()),
  completed: v.boolean(),
  createdAt: v.number(),
});

function cleanTitle(title: string) {
  const value = title.trim();
  if (!value) throw new ConvexError("To-do title cannot be empty");
  return value.slice(0, 1024);
}

function cleanDueDate(dueDate: string | undefined) {
  if (!dueDate) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ConvexError("Due date must use YYYY-MM-DD");
  }
  return dueDate;
}

export const list = deviceQuery
  .input({})
  .returns(v.array(todo))
  .handler(async (ctx) => {
    const rows = await ctx.db
      .query("todos")
      .withIndex("by_deleted_at_and_created_at", (q) => q.eq("deletedAt", undefined))
      .take(500);
    return rows.map((row) => ({
      id: row._id,
      title: row.title,
      assignee: row.assignee,
      priority: row.priority,
      dueDate: row.dueDate,
      completed: row.completed,
      createdAt: row.createdAt,
    }));
  })
  .public();

export const create = deviceMutation
  .input({
    title: v.string(),
    notes: v.optional(v.string()),
    assignee,
    priority,
    dueDate: v.optional(v.string()),
  })
  .returns(v.id("todos"))
  .handler(async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("todos", {
      title: cleanTitle(args.title),
      assignee: args.assignee,
      priority: args.priority,
      dueDate: cleanDueDate(args.dueDate),
      completed: false,
      createdAt: now,
      updatedAt: now,
      syncState: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, {
      todoId: id,
      notes: args.notes,
    });
    return id;
  })
  .public();

export const update = deviceMutation
  .input({
    id: v.id("todos"),
    title: v.string(),
    notes: v.optional(v.string()),
    assignee,
    priority,
    dueDate: v.optional(v.string()),
  })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt !== undefined) throw new ConvexError("To-do not found");
    await ctx.db.patch(args.id, {
      title: cleanTitle(args.title),
      assignee: args.assignee,
      priority: args.priority,
      dueDate: cleanDueDate(args.dueDate),
      updatedAt: Date.now(),
      syncState: "pending",
      syncError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, {
      todoId: args.id,
      notes: args.notes,
    });
    return null;
  })
  .public();

export const toggle = deviceMutation
  .input({ id: v.id("todos") })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt !== undefined) throw new ConvexError("To-do not found");
    await ctx.db.patch(args.id, {
      completed: !row.completed,
      updatedAt: Date.now(),
      syncState: "pending",
      syncError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId: args.id });
    return null;
  })
  .public();

export const remove = deviceMutation
  .input({ id: v.id("todos") })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt !== undefined) return null;
    await ctx.db.patch(args.id, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
      syncState: "pending",
      syncError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId: args.id });
    return null;
  })
  .public();

export const importLegacy = deviceMutation
  .input({ todos: v.array(legacyTodo) })
  .returns(v.number())
  .handler(async (ctx, args) => {
    let imported = 0;
    for (const legacy of args.todos.slice(0, 500)) {
      const existing = await ctx.db
        .query("todos")
        .withIndex("by_legacy_id", (q) => q.eq("legacyId", legacy.id))
        .unique();
      if (existing) continue;
      const id = await ctx.db.insert("todos", {
        title: cleanTitle(legacy.title),
        assignee: legacy.assignee,
        priority: legacy.priority,
        dueDate: cleanDueDate(legacy.dueDate),
        completed: legacy.completed,
        createdAt: legacy.createdAt,
        updatedAt: Date.now(),
        legacyId: legacy.id,
        syncState: "pending",
      });
      await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId: id });
      imported += 1;
    }
    return imported;
  })
  .public();

export const createFromShortcut = internalMutation({
  args: {
    title: v.string(),
    assignee,
    priority,
    dueDate: v.optional(v.string()),
  },
  returns: v.id("todos"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("todos", {
      title: cleanTitle(args.title),
      assignee: args.assignee,
      priority: args.priority,
      dueDate: cleanDueDate(args.dueDate),
      completed: false,
      createdAt: now,
      updatedAt: now,
      syncState: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId: id });
    return id;
  },
});

const syncTodo = v.object({
  id: v.id("todos"),
  title: v.string(),
  assignee,
  priority,
  dueDate: v.optional(v.string()),
  completed: v.boolean(),
  deletedAt: v.optional(v.number()),
  googleTaskId: v.optional(v.string()),
  googleTaskListId: v.optional(v.string()),
  updatedAt: v.number(),
});

// Claim the right to push this to-do to Google. Two overlapping pushes for a
// new to-do would otherwise both POST and leave a duplicate Google task.
export const claimForSync = internalMutation({
  args: { todoId: v.id("todos"), leaseId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("missing") }),
    v.object({ status: v.literal("busy") }),
    v.object({ status: v.literal("claimed"), todo: syncTodo }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return { status: "missing" as const };
    const now = Date.now();
    if (row.syncLeaseId && row.syncLeaseId !== args.leaseId && (row.syncLeaseUntil ?? 0) > now) {
      return { status: "busy" as const };
    }
    await ctx.db.patch(args.todoId, { syncLeaseId: args.leaseId, syncLeaseUntil: now + SYNC_LEASE_MS });
    return {
      status: "claimed" as const,
      todo: {
        id: row._id,
        title: row.title,
        assignee: row.assignee,
        priority: row.priority,
        dueDate: row.dueDate,
        completed: row.completed,
        deletedAt: row.deletedAt,
        googleTaskId: row.googleTaskId,
        googleTaskListId: row.googleTaskListId,
        updatedAt: row.updatedAt,
      },
    };
  },
});

export const listNeedingSync = internalQuery({
  args: {},
  returns: v.array(v.id("todos")),
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("todos")
      .withIndex("by_sync_state", (q) => q.eq("syncState", "pending"))
      .take(250);
    const failed = await ctx.db
      .query("todos")
      .withIndex("by_sync_state", (q) => q.eq("syncState", "error"))
      .take(250);
    return [...pending, ...failed.filter((row) => !isWaitingForRetry(row, now))].map((row) => row._id);
  },
});

export const listDadOutsideGoogleList = internalQuery({
  args: { googleTaskListId: v.string() },
  returns: v.array(v.id("todos")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const active = await ctx.db
      .query("todos")
      .withIndex("by_deleted_at_and_created_at", (q) => q.eq("deletedAt", undefined))
      .take(500);
    return active
      .filter((row) =>
        row.assignee === "dad"
        && row.googleTaskListId !== args.googleTaskListId
        && !isWaitingForRetry(row, now))
      .map((row) => row._id);
  },
});

export const listActiveGoogleTaskIds = internalQuery({
  args: { googleTaskListId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const linked = await ctx.db
      .query("todos")
      .withIndex("by_google_task_list_id_and_google_task_id", (q) =>
        q.eq("googleTaskListId", args.googleTaskListId),
      )
      .take(500);
    return linked.flatMap((row) =>
      row.deletedAt === undefined && row.googleTaskId ? [row.googleTaskId] : [],
    );
  },
});

function releaseLease(row: Doc<"todos">, leaseId: string) {
  return row.syncLeaseId === leaseId ? { syncLeaseId: undefined, syncLeaseUntil: undefined } : {};
}

export const markSynced = internalMutation({
  args: {
    todoId: v.id("todos"),
    leaseId: v.string(),
    // The updatedAt of the version that was pushed. A newer local edit made
    // while the push was running stays pending so it is pushed next.
    pushedUpdatedAt: v.number(),
    googleTaskId: v.optional(v.string()),
    googleTaskListId: v.optional(v.string()),
    googleUpdatedAt: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return null;
    const editedSincePush = row.updatedAt > args.pushedUpdatedAt;
    await ctx.db.patch(args.todoId, {
      googleTaskId: args.googleTaskId ?? row.googleTaskId,
      googleTaskListId: args.googleTaskListId ?? row.googleTaskListId,
      googleUpdatedAt: args.googleUpdatedAt ?? row.googleUpdatedAt,
      ...releaseLease(row, args.leaseId),
      ...(editedSincePush
        ? { syncState: "pending" as const }
        : { syncState: "synced" as const, syncError: undefined, syncAttempts: undefined, nextSyncAt: undefined }),
    });
    return null;
  },
});

export const markSyncError = internalMutation({
  args: {
    todoId: v.id("todos"),
    leaseId: v.string(),
    pushedUpdatedAt: v.number(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return null;
    const syncAttempts = (row.syncAttempts ?? 0) + 1;
    const editedSincePush = row.updatedAt > args.pushedUpdatedAt;
    await ctx.db.patch(args.todoId, {
      syncState: editedSincePush ? "pending" : "error",
      syncError: args.error.slice(0, 500),
      syncAttempts,
      nextSyncAt: Date.now() + syncBackoffMs(syncAttempts),
      ...releaseLease(row, args.leaseId),
    });
    return null;
  },
});

export const releaseSyncLease = internalMutation({
  args: { todoId: v.id("todos"), leaseId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (row) await ctx.db.patch(args.todoId, releaseLease(row, args.leaseId));
    return null;
  },
});

export const upsertFromGoogle = internalMutation({
  args: {
    googleTaskId: v.string(),
    googleTaskListId: v.string(),
    title: v.string(),
    assignee,
    dueDate: v.optional(v.string()),
    completed: v.boolean(),
    deleted: v.boolean(),
    googleUpdatedAt: v.string(),
  },
  returns: v.union(v.null(), v.id("todos")),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("todos")
      .withIndex("by_google_task_list_id_and_google_task_id", (q) =>
        q.eq("googleTaskListId", args.googleTaskListId).eq("googleTaskId", args.googleTaskId),
      )
      .unique();
    const googleUpdated = Date.parse(args.googleUpdatedAt);

    if (args.deleted) {
      // Google Personal is the only place where Dad tasks can be deleted.
      // Unknown historical tombstones stay ignored, while a linked task is
      // hidden from Cannvas without scheduling a delete back to Google.
      if (!existing || existing.deletedAt !== undefined) return existing?._id ?? null;
      const deletedAt = Number.isFinite(googleUpdated) ? googleUpdated : Date.now();
      await ctx.db.patch(existing._id, {
        deletedAt,
        updatedAt: deletedAt,
        googleUpdatedAt: args.googleUpdatedAt,
        syncState: "synced",
        syncError: undefined,
      });
      return existing._id;
    }

    if (existing) {
      // A local removal or reassignment stays local. Keeping the link prevents
      // the still-existing Personal task from being imported as a duplicate.
      if (existing.deletedAt !== undefined || existing.assignee !== "dad") {
        return existing._id;
      }
      // A local edit that has not reached Google yet wins, including one whose
      // push failed and is waiting to retry.
      if (existing.syncState === "pending" || existing.syncState === "error") return existing._id;
      if (existing.googleUpdatedAt && Date.parse(existing.googleUpdatedAt) >= googleUpdated) {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        title: cleanTitle(args.title),
        assignee: args.assignee,
        dueDate: cleanDueDate(args.dueDate),
        completed: args.completed,
        updatedAt: Number.isFinite(googleUpdated) ? googleUpdated : Date.now(),
        googleUpdatedAt: args.googleUpdatedAt,
        syncState: "synced",
        syncError: undefined,
      });
      return existing._id;
    }

    // Historical completed tasks stay in Google. New or existing active
    // Personal tasks become Dad tasks with medium priority.
    if (args.completed) return null;
    return await ctx.db.insert("todos", {
      title: cleanTitle(args.title),
      assignee: "dad",
      priority: "medium",
      dueDate: cleanDueDate(args.dueDate),
      completed: false,
      createdAt: Number.isFinite(googleUpdated) ? googleUpdated : Date.now(),
      updatedAt: Number.isFinite(googleUpdated) ? googleUpdated : Date.now(),
      googleTaskId: args.googleTaskId,
      googleTaskListId: args.googleTaskListId,
      googleUpdatedAt: args.googleUpdatedAt,
      syncState: "synced",
    });
  },
});
