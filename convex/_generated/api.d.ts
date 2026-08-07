/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as boards from "../boards.js";
import type * as calendar from "../calendar.js";
import type * as chores from "../chores.js";
import type * as crons from "../crons.js";
import type * as deviceBackups from "../deviceBackups.js";
import type * as googleTasks from "../googleTasks.js";
import type * as googleTasksStore from "../googleTasksStore.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as inventoryAccessStore from "../inventoryAccessStore.js";
import type * as inventoryAi from "../inventoryAi.js";
import type * as inventoryAiStore from "../inventoryAiStore.js";
import type * as inventoryAuth from "../inventoryAuth.js";
import type * as inventoryConstants from "../inventoryConstants.js";
import type * as inventoryKioskStore from "../inventoryKioskStore.js";
import type * as news from "../news.js";
import type * as todos from "../todos.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  boards: typeof boards;
  calendar: typeof calendar;
  chores: typeof chores;
  crons: typeof crons;
  deviceBackups: typeof deviceBackups;
  googleTasks: typeof googleTasks;
  googleTasksStore: typeof googleTasksStore;
  http: typeof http;
  inventory: typeof inventory;
  inventoryAccessStore: typeof inventoryAccessStore;
  inventoryAi: typeof inventoryAi;
  inventoryAiStore: typeof inventoryAiStore;
  inventoryAuth: typeof inventoryAuth;
  inventoryConstants: typeof inventoryConstants;
  inventoryKioskStore: typeof inventoryKioskStore;
  news: typeof news;
  todos: typeof todos;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
