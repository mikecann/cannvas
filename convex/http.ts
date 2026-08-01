import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tomorrowInPerth() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Perth",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(tomorrow);
}

http.route({
  path: "/google-tasks/connect",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    if (url.searchParams.get("setupToken") !== requiredEnv("GOOGLE_TASKS_SETUP_TOKEN")) {
      return new Response("Not found", { status: 404 });
    }
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.googleTasksStore.createOAuthState, {
      state,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const authorize = new URL(GOOGLE_AUTH_URL);
    authorize.search = new URLSearchParams({
      client_id: requiredEnv("GOOGLE_TASKS_CLIENT_ID"),
      redirect_uri: requiredEnv("GOOGLE_TASKS_REDIRECT_URI"),
      response_type: "code",
      scope: "https://www.googleapis.com/auth/tasks",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return Response.redirect(authorize.toString(), 302);
  }),
});

http.route({
  path: "/google-tasks/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return new Response(`Google authorization was cancelled: ${oauthError}`, { status: 400 });
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !await ctx.runMutation(internal.googleTasksStore.consumeOAuthState, { state })) {
      return new Response("This authorization link is invalid or has expired.", { status: 400 });
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("GOOGLE_TASKS_CLIENT_ID"),
        client_secret: requiredEnv("GOOGLE_TASKS_CLIENT_SECRET"),
        redirect_uri: requiredEnv("GOOGLE_TASKS_REDIRECT_URI"),
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!response.ok) {
      return new Response(`Google authorization failed: ${(await response.text()).slice(0, 500)}`, {
        status: 502,
      });
    }
    const token = await response.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };
    await ctx.runMutation(internal.googleTasksStore.saveConnection, {
      ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      accessToken: token.access_token,
      accessTokenExpiresAt: Date.now() + token.expires_in * 1000,
    });
    await ctx.scheduler.runAfter(0, internal.googleTasks.setupPersonalList, {});
    return new Response(
      "Google Tasks is connected to Cannvas. You can close this tab.",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }),
});

http.route({
  path: "/quick-add-todo",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = requiredEnv("CANNVAS_QUICK_ADD_TOKEN");
    if (request.headers.get("Authorization") !== `Bearer ${expected}`) {
      return json({ error: "Unauthorized" }, 401);
    }
    let body: {
      title?: unknown;
      dueDate?: unknown;
      assignee?: unknown;
      priority?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be JSON" }, 400);
    }
    if (typeof body.title !== "string" || !body.title.trim()) {
      return json({ error: "title is required" }, 400);
    }
    const assignee = body.assignee ?? "dad";
    const priority = body.priority ?? "medium";
    if (assignee !== "mum" && assignee !== "dad" && assignee !== "josh") {
      return json({ error: "assignee must be mum, dad, or josh" }, 400);
    }
    if (priority !== "low" && priority !== "medium" && priority !== "high") {
      return json({ error: "priority must be low, medium, or high" }, 400);
    }
    if (
      body.dueDate !== undefined
      && (typeof body.dueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate))
    ) {
      return json({ error: "dueDate must use YYYY-MM-DD" }, 400);
    }
    const id = await ctx.runMutation(internal.todos.createFromShortcut, {
      title: body.title,
      dueDate: (body.dueDate as string | undefined) ?? tomorrowInPerth(),
      assignee,
      priority,
    });
    return json({ id, created: true }, 201);
  }),
});

// Keep this last: static hosting owns the catch-all route after the API and
// OAuth endpoints above have had a chance to match.
registerStaticRoutes(http, components.staticHosting);

export default http;
