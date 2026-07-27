import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

const assignee = v.union(v.literal("mum"), v.literal("dad"), v.literal("josh"));
const priority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

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
  if (!value) throw new Error("To-do title cannot be empty");
  return value.slice(0, 1024);
}

function cleanDueDate(dueDate: string | undefined) {
  if (!dueDate) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error("Due date must use YYYY-MM-DD");
  }
  return dueDate;
}

function requireMirrorAccess(accessToken: string) {
  const expected = process.env.CANNVAS_TODO_ACCESS_TOKEN?.trim();
  if (!expected || accessToken !== expected) throw new Error("Unauthorized");
}

export const list = query({
  args: { accessToken: v.string() },
  returns: v.array(todo),
  handler: async (ctx, args) => {
    requireMirrorAccess(args.accessToken);
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
  },
});

export const create = mutation({
  args: {
    accessToken: v.string(),
    title: v.string(),
    assignee,
    priority,
    dueDate: v.optional(v.string()),
  },
  returns: v.id("todos"),
  handler: async (ctx, args) => {
    requireMirrorAccess(args.accessToken);
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

export const update = mutation({
  args: {
    accessToken: v.string(),
    id: v.id("todos"),
    title: v.string(),
    assignee,
    priority,
    dueDate: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireMirrorAccess(args.accessToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt !== undefined) throw new Error("To-do not found");
    await ctx.db.patch(args.id, {
      title: cleanTitle(args.title),
      assignee: args.assignee,
      priority: args.priority,
      dueDate: cleanDueDate(args.dueDate),
      updatedAt: Date.now(),
      syncState: "pending",
      syncError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId: args.id });
    return null;
  },
});

export const toggle = mutation({
  args: { accessToken: v.string(), id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireMirrorAccess(args.accessToken);
    const row = await ctx.db.get(args.id);
    if (!row || row.deletedAt !== undefined) throw new Error("To-do not found");
    await ctx.db.patch(args.id, {
      completed: !row.completed,
      updatedAt: Date.now(),
      syncState: "pending",
      syncError: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId: args.id });
    return null;
  },
});

export const remove = mutation({
  args: { accessToken: v.string(), id: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireMirrorAccess(args.accessToken);
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
  },
});

export const importLegacy = mutation({
  args: {
    accessToken: v.string(),
    todos: v.array(legacyTodo),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireMirrorAccess(args.accessToken);
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
  },
});

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

export const getForSync = internalQuery({
  args: { todoId: v.id("todos") },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("todos"),
      title: v.string(),
      assignee,
      priority,
      dueDate: v.optional(v.string()),
      completed: v.boolean(),
      deletedAt: v.optional(v.number()),
      googleTaskId: v.optional(v.string()),
      googleTaskListId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return null;
    return {
      id: row._id,
      title: row.title,
      assignee: row.assignee,
      priority: row.priority,
      dueDate: row.dueDate,
      completed: row.completed,
      deletedAt: row.deletedAt,
      googleTaskId: row.googleTaskId,
      googleTaskListId: row.googleTaskListId,
    };
  },
});

export const listNeedingSync = internalQuery({
  args: {},
  returns: v.array(v.id("todos")),
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("todos")
      .withIndex("by_sync_state", (q) => q.eq("syncState", "pending"))
      .take(250);
    const failed = await ctx.db
      .query("todos")
      .withIndex("by_sync_state", (q) => q.eq("syncState", "error"))
      .take(250);
    return [...pending, ...failed].map((row) => row._id);
  },
});

export const markSynced = internalMutation({
  args: {
    todoId: v.id("todos"),
    googleTaskId: v.optional(v.string()),
    googleTaskListId: v.optional(v.string()),
    googleUpdatedAt: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.todoId);
    if (!row) return null;
    await ctx.db.patch(args.todoId, {
      googleTaskId: args.googleTaskId ?? row.googleTaskId,
      googleTaskListId: args.googleTaskListId ?? row.googleTaskListId,
      googleUpdatedAt: args.googleUpdatedAt ?? row.googleUpdatedAt,
      syncState: "synced",
      syncError: undefined,
    });
    return null;
  },
});

export const markSyncError = internalMutation({
  args: {
    todoId: v.id("todos"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.todoId)) {
      await ctx.db.patch(args.todoId, {
        syncState: "error",
        syncError: args.error.slice(0, 500),
      });
    }
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

    if (existing) {
      // A local edit that has not reached Google wins this poll cycle.
      if (existing.syncState === "pending") return existing._id;
      if (existing.googleUpdatedAt && Date.parse(existing.googleUpdatedAt) >= googleUpdated) {
        return existing._id;
      }
      await ctx.db.patch(existing._id, {
        title: cleanTitle(args.title),
        assignee: args.assignee,
        dueDate: cleanDueDate(args.dueDate),
        completed: args.completed,
        deletedAt: args.deleted ? Date.now() : undefined,
        updatedAt: Number.isFinite(googleUpdated) ? googleUpdated : Date.now(),
        googleUpdatedAt: args.googleUpdatedAt,
        syncState: "synced",
        syncError: undefined,
      });
      return existing._id;
    }

    if (args.deleted) return null;
    return await ctx.db.insert("todos", {
      title: cleanTitle(args.title),
      assignee: args.assignee,
      priority: "medium",
      dueDate: cleanDueDate(args.dueDate),
      completed: args.completed,
      createdAt: Number.isFinite(googleUpdated) ? googleUpdated : Date.now(),
      updatedAt: Number.isFinite(googleUpdated) ? googleUpdated : Date.now(),
      googleTaskId: args.googleTaskId,
      googleTaskListId: args.googleTaskListId,
      googleUpdatedAt: args.googleUpdatedAt,
      syncState: "synced",
    });
  },
});
