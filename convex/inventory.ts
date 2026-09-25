import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import { getInventoryAccess, inventoryMutation, inventoryQuery, publicQuery } from "./fluent";
import { MAX_INVENTORY_PHOTOS } from "./inventoryConstants";
import { buildSearchText } from "./lib/inventorySearch";
import { inventoryEnrichmentStatus, inventoryRole, inventoryStatus } from "./lib/validators";

const attribute = v.object({ label: v.string(), value: v.string() });
const source = v.object({ title: v.string(), url: v.string() });
const itemSummary = v.object({
  _id: v.id("inventoryItems"),
  title: v.string(),
  description: v.string(),
  category: v.string(),
  tags: v.array(v.string()),
  condition: v.string(),
  quantity: v.number(),
  currentLocationId: v.id("inventoryLocations"),
  currentLocationName: v.string(),
  status: inventoryStatus,
  enrichmentStatus: inventoryEnrichmentStatus,
  updatedAt: v.number(),
  photoUrl: v.union(v.string(), v.null()),
});
const publicGiveawayItem = v.object({
  _id: v.id("inventoryItems"),
  title: v.string(),
  description: v.string(),
  category: v.string(),
  condition: v.string(),
  quantity: v.number(),
  boxOnly: v.boolean(),
  enrichmentStatus: inventoryEnrichmentStatus,
  updatedAt: v.number(),
  photoUrls: v.array(v.string()),
});

const PUBLIC_GIVEAWAY_LOCATIONS = ["giveaway", "to giveaway"] as const;

function normalizeLocation(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

function cleanLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

async function findOrCreateLocation(ctx: MutationCtx, name: string) {
  const cleanName = cleanLocationName(name);
  if (!cleanName) throw new Error("Choose or enter a location.");
  const normalizedName = normalizeLocation(cleanName);
  const existing = await ctx.db
    .query("inventoryLocations")
    .withIndex("by_normalized_name", (q) => q.eq("normalizedName", normalizedName))
    .unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      name: cleanName,
      usageCount: existing.usageCount + 1,
      lastUsedAt: now,
      archived: false,
    });
    return { id: existing._id, name: cleanName };
  }
  const id = await ctx.db.insert("inventoryLocations", {
    name: cleanName,
    normalizedName,
    usageCount: 1,
    lastUsedAt: now,
    archived: false,
    createdAt: now,
  });
  return { id, name: cleanName };
}

export const accessStatus = publicQuery
  .input({})
  .returns(v.object({
    hasAccess: v.boolean(),
    role: v.union(inventoryRole, v.null()),
  }))
  .handler(async (ctx) => {
    // Public so the sign-in screen can tell "not signed in" from "no access".
    const userId = await getAuthUserId(ctx);
    if (!userId) return { hasAccess: false, role: null };
    const access = await getInventoryAccess(ctx.db, userId);
    return { hasAccess: Boolean(access), role: access?.role ?? null };
  })
  .public();

export const generateUploadUrl = inventoryMutation
  .input({})
  .returns(v.string())
  .handler(async (ctx) => {
    return ctx.storage.generateUploadUrl();
  })
  .public();

export const locationSuggestions = inventoryQuery
  .input({})
  .returns(v.array(
    v.object({
      _id: v.id("inventoryLocations"),
      name: v.string(),
      usageCount: v.number(),
    }),
  ))
  .handler(async (ctx) => {
    const [popular, recent] = await Promise.all([
      ctx.db
        .query("inventoryLocations")
        .withIndex("by_archived_and_usage_count", (q) => q.eq("archived", false))
        .order("desc")
        .take(12),
      ctx.db
        .query("inventoryLocations")
        .withIndex("by_archived_and_last_used_at", (q) => q.eq("archived", false))
        .order("desc")
        .take(12),
    ]);
    const unique = new Map([...popular, ...recent].map((location) => [location._id, location]));
    return [...unique.values()]
      .slice(0, 16)
      .map(({ _id, name, usageCount }) => ({ _id, name, usageCount }));
  })
  .public();

// This is deliberately the only unauthenticated inventory read. It exposes a
// small, explicit projection of active items in the approved Giveaway location
// without leaking household locations, history, attributes, or AI sources.
export const publicGiveaway = publicQuery
  .input({})
  .returns(v.array(publicGiveawayItem))
  .handler(async (ctx) => {
    const locations = await Promise.all(
      PUBLIC_GIVEAWAY_LOCATIONS.map((normalizedName) =>
        ctx.db
          .query("inventoryLocations")
          .withIndex("by_normalized_name", (q) => q.eq("normalizedName", normalizedName))
          .unique(),
      ),
    );
    const locationIds = locations.flatMap((location) => location ? [location._id] : []);
    const itemGroups = await Promise.all(
      locationIds.map((locationId) =>
        ctx.db
          .query("inventoryItems")
          .withIndex("by_current_location_id_and_status_and_updated_at", (q) =>
            q.eq("currentLocationId", locationId).eq("status", "active"),
          )
          .order("desc")
          .take(100),
      ),
    );
    const items = itemGroups.flat().sort((a, b) => b.updatedAt - a.updatedAt);

    return Promise.all(items.map(async (item) => {
      const photos = await ctx.db
        .query("inventoryPhotos")
        .withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", item._id))
        .take(8);
      const photoUrls = await Promise.all(photos.map((photo) => ctx.storage.getUrl(photo.storageId)));
      return {
        _id: item._id,
        title: item.title,
        description: item.description,
        category: item.category,
        condition: item.condition,
        quantity: item.quantity,
        boxOnly: item.tags.some((tag) => tag.trim().toLocaleLowerCase("en-AU") === "box only"),
        enrichmentStatus: item.enrichmentStatus,
        updatedAt: item.updatedAt,
        photoUrls: photoUrls.flatMap((url) => url ? [url] : []),
      };
    }));
  })
  .public();

export const create = inventoryMutation
  .input({
    storageIds: v.array(v.id("_storage")),
    locationName: v.string(),
    boxOnly: v.boolean(),
  })
  .returns(v.id("inventoryItems"))
  .handler(async (ctx, args) => {
    const userId = ctx.userId;
    if (args.storageIds.length === 0) throw new Error("Take at least one photo.");
    if (args.storageIds.length > 8) throw new Error("Add at most eight photos at a time.");
    const location = await findOrCreateLocation(ctx, args.locationName);
    const now = Date.now();
    const draft = {
      title: "Identifying item…",
      description: "",
      category: "Uncategorised",
      tags: args.boxOnly ? ["box only"] : [],
      condition: "Unknown",
      quantity: 1,
      attributes: [] as Array<{ label: string; value: string }>,
      currentLocationName: location.name,
    };
    const itemId = await ctx.db.insert("inventoryItems", {
      ...draft,
      currentLocationId: location.id,
      status: "active",
      enrichmentStatus: "queued",
      enrichmentGeneration: 1,
      manualEditVersion: 0,
      aiSources: [],
      searchText: buildSearchText(draft),
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    await Promise.all(args.storageIds.map((storageId, index) => ctx.db.insert("inventoryPhotos", {
      itemId,
      storageId,
      sortOrder: index,
      capturedAt: now,
      addedBy: userId,
    })));
    await ctx.db.insert("inventoryEvents", {
      itemId,
      type: "added",
      actorId: userId,
      toLocationId: location.id,
      toLocationName: location.name,
      occurredAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.inventoryAi.enrich, { itemId, generation: 1 });
    return itemId;
  })
  .public();

export const list = inventoryQuery
  .input({
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(inventoryStatus),
    locationId: v.optional(v.id("inventoryLocations")),
  })
  .returns(v.object({ page: v.array(itemSummary), isDone: v.boolean(), continueCursor: v.string() }))
  .handler(async (ctx, args) => {
    const status = args.status ?? "active";
    const search = args.search?.trim();
    const locationId = args.locationId;
    const result = search
      ? await ctx.db
          .query("inventoryItems")
          .withSearchIndex("search_inventory", (q) => {
            const searched = q.search("searchText", search).eq("status", status);
            return locationId ? searched.eq("currentLocationId", locationId) : searched;
          })
          .paginate(args.paginationOpts)
      : locationId
        ? await ctx.db
            .query("inventoryItems")
            .withIndex("by_current_location_id_and_status_and_updated_at", (q) =>
              q.eq("currentLocationId", locationId).eq("status", status),
            )
            .order("desc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("inventoryItems")
            .withIndex("by_status_and_updated_at", (q) => q.eq("status", status))
            .order("desc")
            .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (item) => {
        const photo = await ctx.db
          .query("inventoryPhotos")
          .withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", item._id))
          .first();
        return {
          _id: item._id,
          title: item.title,
          description: item.description,
          category: item.category,
          tags: item.tags,
          condition: item.condition,
          quantity: item.quantity,
          currentLocationId: item.currentLocationId,
          currentLocationName: item.currentLocationName,
          status: item.status,
          enrichmentStatus: item.enrichmentStatus,
          updatedAt: item.updatedAt,
          photoUrl: photo ? await ctx.storage.getUrl(photo.storageId) : null,
        };
      }),
    );
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  })
  .public();

export const get = inventoryQuery
  .input({ itemId: v.id("inventoryItems") })
  .returns(v.union(v.null(), v.object({
    item: v.object({
      _id: v.id("inventoryItems"), title: v.string(), description: v.string(), category: v.string(),
      tags: v.array(v.string()), condition: v.string(), quantity: v.number(), attributes: v.array(attribute),
      currentLocationId: v.id("inventoryLocations"), currentLocationName: v.string(), status: inventoryStatus,
      enrichmentStatus: v.string(), enrichmentError: v.optional(v.string()), aiModel: v.optional(v.string()),
      aiSources: v.array(source), createdAt: v.number(), updatedAt: v.number(), removedAt: v.optional(v.number()),
    }),
    photos: v.array(v.object({ _id: v.id("inventoryPhotos"), url: v.union(v.string(), v.null()), capturedAt: v.number() })),
    events: v.array(v.object({ _id: v.id("inventoryEvents"), type: v.string(), note: v.optional(v.string()),
      fromLocationName: v.optional(v.string()), toLocationName: v.optional(v.string()), occurredAt: v.number() })),
  })))
  .handler(async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const [photos, events] = await Promise.all([
      ctx.db.query("inventoryPhotos").withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", args.itemId)).take(MAX_INVENTORY_PHOTOS),
      ctx.db.query("inventoryEvents").withIndex("by_item_id_and_occurred_at", (q) => q.eq("itemId", args.itemId)).order("desc").take(100),
    ]);
    return {
      item: {
        _id: item._id, title: item.title, description: item.description, category: item.category,
        tags: item.tags, condition: item.condition, quantity: item.quantity, attributes: item.attributes,
        currentLocationId: item.currentLocationId, currentLocationName: item.currentLocationName,
        status: item.status, enrichmentStatus: item.enrichmentStatus, enrichmentError: item.enrichmentError,
        aiModel: item.aiModel, aiSources: item.aiSources, createdAt: item.createdAt, updatedAt: item.updatedAt,
        removedAt: item.removedAt,
      },
      photos: await Promise.all(photos.map(async (photo) => ({
        _id: photo._id, url: await ctx.storage.getUrl(photo.storageId), capturedAt: photo.capturedAt,
      }))),
      events: events.map((event) => ({
        _id: event._id, type: event.type, note: event.note, fromLocationName: event.fromLocationName,
        toLocationName: event.toLocationName, occurredAt: event.occurredAt,
      })),
    };
  })
  .public();

export const updateDetails = inventoryMutation
  .input({
    itemId: v.id("inventoryItems"), title: v.string(), description: v.string(), category: v.string(),
    tags: v.array(v.string()), condition: v.string(), quantity: v.number(), attributes: v.array(attribute),
  })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const userId = ctx.userId;
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found.");
    const details = {
      title: args.title.trim() || "Untitled item", description: args.description.trim(),
      category: args.category.trim() || "Uncategorised", tags: args.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 30),
      condition: args.condition.trim() || "Unknown", quantity: Math.max(1, Math.floor(args.quantity)),
      attributes: args.attributes.map(({ label, value }) => ({ label: label.trim(), value: value.trim() })).filter(({ label, value }) => label && value).slice(0, 40),
      currentLocationName: item.currentLocationName,
    };
    await ctx.db.patch(args.itemId, {
      ...details,
      searchText: buildSearchText(details),
      manualEditVersion: (item.manualEditVersion ?? 0) + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("inventoryEvents", { itemId: args.itemId, type: "edited", actorId: userId, occurredAt: Date.now() });
    return null;
  })
  .public();

export const move = inventoryMutation
  .input({ itemId: v.id("inventoryItems"), locationName: v.string(), note: v.optional(v.string()) })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const userId = ctx.userId;
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found.");
    const location = await findOrCreateLocation(ctx, args.locationName);
    const next = { ...item, currentLocationName: location.name };
    await ctx.db.patch(args.itemId, {
      currentLocationId: location.id, currentLocationName: location.name,
      searchText: buildSearchText(next), updatedAt: Date.now(),
    });
    await ctx.db.insert("inventoryEvents", {
      itemId: args.itemId, type: "moved", actorId: userId,
      fromLocationId: item.currentLocationId, fromLocationName: item.currentLocationName,
      toLocationId: location.id, toLocationName: location.name,
      note: args.note?.trim() || undefined, occurredAt: Date.now(),
    });
    return null;
  })
  .public();

export const setStatus = inventoryMutation
  .input({ itemId: v.id("inventoryItems"), status: inventoryStatus, note: v.optional(v.string()) })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const userId = ctx.userId;
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found.");
    const now = Date.now();
    await ctx.db.patch(args.itemId, { status: args.status, removedAt: args.status === "active" ? undefined : now, updatedAt: now });
    await ctx.db.insert("inventoryEvents", {
      itemId: args.itemId,
      type: args.status === "active" ? "restored" : args.status,
      actorId: userId, note: args.note?.trim() || undefined, occurredAt: now,
    });
    return null;
  })
  .public();

export const addPhotos = inventoryMutation
  .input({ itemId: v.id("inventoryItems"), storageIds: v.array(v.id("_storage")), rerunEnrichment: v.boolean() })
  .returns(v.null())
  .handler(async (ctx, args) => {
    const userId = ctx.userId;
    if (args.storageIds.length === 0 || args.storageIds.length > 8) throw new Error("Add between one and eight photos.");
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found.");
    const existingPhotos = await ctx.db.query("inventoryPhotos")
      .withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", args.itemId))
      .order("desc")
      .take(MAX_INVENTORY_PHOTOS + 1);
    if (existingPhotos.length + args.storageIds.length > MAX_INVENTORY_PHOTOS) {
      throw new Error(`An item can have at most ${MAX_INVENTORY_PHOTOS} photos.`);
    }
    const lastPhoto = existingPhotos[0];
    const startSortOrder = (lastPhoto?.sortOrder ?? -1) + 1;
    const now = Date.now();
    const generation = (item.enrichmentGeneration ?? 0) + 1;
    await Promise.all(args.storageIds.map((storageId, index) => ctx.db.insert("inventoryPhotos", {
      itemId: args.itemId,
      storageId,
      sortOrder: startSortOrder + index,
      capturedAt: now,
      addedBy: userId,
    })));
    await ctx.db.insert("inventoryEvents", {
      itemId: args.itemId, type: "photo_added", actorId: userId,
      note: `${args.storageIds.length} photo${args.storageIds.length === 1 ? "" : "s"} added`, occurredAt: now,
    });
    await ctx.db.patch(args.itemId, {
      updatedAt: now,
      ...(args.rerunEnrichment ? {
        enrichmentStatus: "queued" as const,
        enrichmentGeneration: generation,
        enrichmentError: undefined,
      } : {}),
    });
    if (args.rerunEnrichment) {
      await ctx.scheduler.runAfter(0, internal.inventoryAi.enrich, {
        itemId: args.itemId,
        generation,
      });
    }
    return null;
  })
  .public();
