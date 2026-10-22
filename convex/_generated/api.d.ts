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
import type * as chef from "../chef.js";
import type * as chefLinks from "../chefLinks.js";
import type * as chefMail from "../chefMail.js";
import type * as chefWall from "../chefWall.js";
import type * as chores from "../chores.js";
import type * as crons from "../crons.js";
import type * as deviceBackups from "../deviceBackups.js";
import type * as deviceBoards from "../deviceBoards.js";
import type * as fluent from "../fluent.js";
import type * as googleTasks from "../googleTasks.js";
import type * as googleTasksStore from "../googleTasksStore.js";
import type * as http from "../http.js";
import type * as inventory from "../inventory.js";
import type * as inventoryAccessStore from "../inventoryAccessStore.js";
import type * as inventoryAi from "../inventoryAi.js";
import type * as inventoryAiStore from "../inventoryAiStore.js";
import type * as inventoryConstants from "../inventoryConstants.js";
import type * as inventoryKioskStore from "../inventoryKioskStore.js";
import type * as lib_backoff from "../lib/backoff.js";
import type * as lib_chefLinks from "../lib/chefLinks.js";
import type * as lib_chefWall from "../lib/chefWall.js";
import type * as lib_inventorySearch from "../lib/inventorySearch.js";
import type * as lib_inventoryWriteGuard from "../lib/inventoryWriteGuard.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as lib_validators from "../lib/validators.js";
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
  chef: typeof chef;
  chefLinks: typeof chefLinks;
  chefMail: typeof chefMail;
  chefWall: typeof chefWall;
  chores: typeof chores;
  crons: typeof crons;
  deviceBackups: typeof deviceBackups;
  deviceBoards: typeof deviceBoards;
  fluent: typeof fluent;
  googleTasks: typeof googleTasks;
  googleTasksStore: typeof googleTasksStore;
  http: typeof http;
  inventory: typeof inventory;
  inventoryAccessStore: typeof inventoryAccessStore;
  inventoryAi: typeof inventoryAi;
  inventoryAiStore: typeof inventoryAiStore;
  inventoryConstants: typeof inventoryConstants;
  inventoryKioskStore: typeof inventoryKioskStore;
  "lib/backoff": typeof lib_backoff;
  "lib/chefLinks": typeof lib_chefLinks;
  "lib/chefWall": typeof lib_chefWall;
  "lib/inventorySearch": typeof lib_inventorySearch;
  "lib/inventoryWriteGuard": typeof lib_inventoryWriteGuard;
  "lib/tokens": typeof lib_tokens;
  "lib/validators": typeof lib_validators;
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
  feedback: import("@convex-dev/feedback/_generated/component.js").ComponentApi<"feedback">;
  chefCloud: import("@convex-dev/chef-cloud/_generated/component.js").ComponentApi<"chefCloud">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
