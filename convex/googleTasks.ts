import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { internalAction } from "./_generated/server";

const GOOGLE_API_BASE = "https://tasks.googleapis.com/tasks/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PERSONAL_LIST_TITLE = "Personal";

type Connection = {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  dadListId?: string;
  lastPolledAt?: number;
};
type GoogleTaskList = { id: string; title: string };
type GoogleTask = {
  id: string;
  title?: string;
  updated?: string;
  status?: "needsAction" | "completed";
  due?: string;
  deleted?: boolean;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function googleRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GOOGLE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Google Tasks ${response.status}: ${detail}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

async function getAccessToken(ctx: ActionCtx, connection?: Connection) {
  const current = connection ?? await ctx.runQuery(internal.googleTasksStore.getConnection, {});
  if (!current) throw new Error("Google Tasks is not connected");
  if (
    current.accessToken
    && current.accessTokenExpiresAt
    && current.accessTokenExpiresAt > Date.now() + 60_000
  ) {
    return current.accessToken;
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_TASKS_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_TASKS_CLIENT_SECRET"),
      refresh_token: current.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth refresh failed: ${(await response.text()).slice(0, 500)}`);
  }
  const token = await response.json() as { access_token: string; expires_in: number };
  await ctx.runMutation(internal.googleTasksStore.saveAccessToken, {
    accessToken: token.access_token,
    accessTokenExpiresAt: Date.now() + token.expires_in * 1000,
  });
  return token.access_token;
}

async function findPersonalList(ctx: ActionCtx, connection: Connection, accessToken: string) {
  const firstPage = await googleRequest<{ items?: GoogleTaskList[]; nextPageToken?: string }>(
    accessToken,
    "/users/@me/lists?maxResults=1000",
  );
  const lists = [...(firstPage.items ?? [])];
  let pageToken = firstPage.nextPageToken;
  while (pageToken) {
    const page = await googleRequest<{ items?: GoogleTaskList[]; nextPageToken?: string }>(
      accessToken,
      `/users/@me/lists?maxResults=1000&pageToken=${encodeURIComponent(pageToken)}`,
    );
    lists.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  }

  const personal = lists.find(
    (list) => list.title.trim().toLocaleLowerCase() === PERSONAL_LIST_TITLE.toLocaleLowerCase(),
  );
  if (!personal) {
    throw new Error(`Google Tasks list "${PERSONAL_LIST_TITLE}" was not found`);
  }

  // Always resolve by title so an older cached "Cannvas - Dad" ID is replaced.
  if (connection.dadListId !== personal.id) {
    await ctx.runMutation(internal.googleTasksStore.savePersonalListId, {
      dadListId: personal.id,
    });
  }
  return personal.id;
}

export const setupPersonalList = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const connection = await ctx.runQuery(internal.googleTasksStore.getConnection, {});
    if (!connection) return null;
    const accessToken = await getAccessToken(ctx, connection);
    const personalListId = await findPersonalList(ctx, connection, accessToken);
    const todoIds = await ctx.runQuery(internal.todos.listNeedingSync, {});
    const wrongListTodoIds = await ctx.runQuery(internal.todos.listDadOutsideGoogleList, {
      googleTaskListId: personalListId,
    });
    for (const todoId of new Set([...todoIds, ...wrongListTodoIds])) {
      await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId });
    }
    await ctx.scheduler.runAfter(0, internal.googleTasks.poll, { fullSync: true });
    return null;
  },
});

export const pushTodo = internalAction({
  args: { todoId: v.id("todos") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.googleTasksStore.getConnection, {});
    if (!connection) return null;
    const todo = await ctx.runQuery(internal.todos.getForSync, args);
    if (!todo) return null;

    try {
      const accessToken = await getAccessToken(ctx, connection);
      const targetListId = await findPersonalList(ctx, connection, accessToken);

      if (todo.assignee !== "dad") {
        // Reassignment is not deletion. Keep the Google task and its link so a
        // later Personal poll does not import a duplicate Dad task.
        await ctx.runMutation(internal.todos.markSynced, { todoId: todo.id });
        return null;
      }

      if (todo.deletedAt !== undefined) {
        // Cannvas removals stay local. Completing a task is the supported way
        // to make its completed state flow to Personal.
        await ctx.runMutation(internal.todos.markSynced, { todoId: todo.id });
        return null;
      }

      let googleTaskId = todo.googleTaskId;
      let googleTaskListId = todo.googleTaskListId;
      if (googleTaskId && googleTaskListId && googleTaskListId !== targetListId) {
        // Link the Dad task into Personal without deleting the old Google copy.
        googleTaskId = undefined;
        googleTaskListId = undefined;
      }

      const body = {
        title: todo.title,
        status: todo.completed ? "completed" : "needsAction",
        due: todo.dueDate ? `${todo.dueDate}T00:00:00.000Z` : null,
        completed: todo.completed ? new Date().toISOString() : null,
      };
      let saved: GoogleTask | undefined;
      if (googleTaskId && googleTaskListId) {
        try {
          saved = await googleRequest<GoogleTask>(
            accessToken,
            `/lists/${encodeURIComponent(googleTaskListId)}/tasks/${encodeURIComponent(googleTaskId)}`,
            { method: "PATCH", body: JSON.stringify(body) },
          );
        } catch (error) {
          // A Google-side deletion never removes the Cannvas record. If Mike
          // later edits it in Cannvas, recreate the Personal copy instead.
          if (!(error instanceof Error) || !error.message.includes("Google Tasks 404")) throw error;
        }
        // Google may accept a PATCH for a tombstoned task while leaving it
        // hidden. Treat that response like a missing task and create a fresh
        // visible Personal copy below.
        if (saved?.deleted) saved = undefined;
      }
      if (!saved) {
        saved = await googleRequest<GoogleTask>(
          accessToken,
          `/lists/${encodeURIComponent(targetListId)}/tasks`,
          { method: "POST", body: JSON.stringify(body) },
        );
      }

      await ctx.runMutation(internal.todos.markSynced, {
        todoId: todo.id,
        googleTaskId: saved.id,
        googleTaskListId: targetListId,
        googleUpdatedAt: saved.updated,
      });
    } catch (error) {
      await ctx.runMutation(internal.todos.markSyncError, {
        todoId: args.todoId,
        error: error instanceof Error ? error.message : "Unknown Google Tasks sync error",
      });
    }
    return null;
  },
});

export const poll = internalAction({
  args: { fullSync: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.runQuery(internal.googleTasksStore.getConnection, {});
    if (!connection) return null;
    const startedAt = Date.now();
    const accessToken = await getAccessToken(ctx, connection);
    const personalListId = await findPersonalList(ctx, connection, accessToken);
    const todoIds = await ctx.runQuery(internal.todos.listNeedingSync, {});
    const wrongListTodoIds = await ctx.runQuery(internal.todos.listDadOutsideGoogleList, {
      googleTaskListId: personalListId,
    });
    for (const todoId of new Set([...todoIds, ...wrongListTodoIds])) {
      await ctx.scheduler.runAfter(0, internal.googleTasks.pushTodo, { todoId });
    }
    const updatedMin = !args.fullSync && connection.lastPolledAt
      ? new Date(connection.lastPolledAt - 5 * 60_000).toISOString()
      : undefined;

    let pageToken: string | undefined;
    let pageCount = 0;
    do {
      const query = new URLSearchParams({
        maxResults: "100",
        showCompleted: "true",
        showHidden: "true",
        showDeleted: "true",
      });
      if (updatedMin) query.set("updatedMin", updatedMin);
      if (pageToken) query.set("pageToken", pageToken);
      const page = await googleRequest<{ items?: GoogleTask[]; nextPageToken?: string }>(
        accessToken,
        `/lists/${encodeURIComponent(personalListId)}/tasks?${query.toString()}`,
      );
      for (const task of page.items ?? []) {
        await ctx.runMutation(internal.todos.upsertFromGoogle, {
          googleTaskId: task.id,
          googleTaskListId: personalListId,
          title: task.title?.trim() || "Untitled task",
          assignee: "dad",
          dueDate: task.due?.slice(0, 10),
          completed: task.status === "completed",
          deleted: task.deleted === true,
          googleUpdatedAt: task.updated ?? new Date().toISOString(),
        });
      }
      pageToken = page.nextPageToken;
      pageCount += 1;
      if (pageCount >= 10 && pageToken) {
        throw new Error("Google Tasks sync exceeded 1,000 tasks in Personal");
      }
    } while (pageToken);

    await ctx.runMutation(internal.googleTasksStore.saveLastPolledAt, { lastPolledAt: startedAt });
    return null;
  },
});
