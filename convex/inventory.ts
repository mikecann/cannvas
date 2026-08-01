import { paginationOptsValidator, type GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireInventoryUser } from "./inventoryAuth";

const inventoryStatus = v.union(
  v.literal("active"),
  v.literal("disposed"),
  v.literal("donated"),
  v.literal("sold"),
  v.literal("lost"),
);
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
  enrichmentStatus: v.union(
    v.literal("queued"),
    v.literal("processing"),
    v.literal("ready"),
    v.literal("failed"),
  ),
  updatedAt: v.number(),
  photoUrl: v.union(v.string(), v.null()),
});

function normalizeLocation(name: string) {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-AU");
}

function cleanLocationName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function buildSearchText(item: {
  title: string;
  description: string;
  category: string;
  tags: string[];
  condition: string;
  attributes: Array<{ label: string; value: string }>;
  currentLocationName: string;
}) {
  return [
    item.title,
    item.description,
    item.category,
    item.condition,
    item.currentLocationName,
    ...item.tags,
    ...item.attributes.flatMap(({ label, value }) => [label, value]),
  ].join(" ");
}

async function findOrCreateLocation(ctx: GenericMutationCtx<DataModel>, name: string) {
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

export const accessStatus = query({
  args: {},
  returns: v.object({
    hasAccess: v.boolean(),
    role: v.union(v.literal("owner"), v.literal("member"), v.null()),
  }),
  handler: async (ctx) => {
    const userId = await requireInventoryUser(ctx).catch(() => null);
    if (!userId) return { hasAccess: false, role: null };
    const access = await ctx.db
      .query("inventoryAccess")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    return { hasAccess: Boolean(access), role: access?.role ?? null };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireInventoryUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const locationSuggestions = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("inventoryLocations"),
      name: v.string(),
      usageCount: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireInventoryUser(ctx);
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
  },
});

export const create = mutation({
  args: {
    storageIds: v.array(v.id("_storage")),
    locationName: v.string(),
  },
  returns: v.id("inventoryItems"),
  handler: async (ctx, args) => {
    const userId = await requireInventoryUser(ctx);
    if (args.storageIds.length === 0) throw new Error("Take at least one photo.");
    if (args.storageIds.length > 8) throw new Error("Add at most eight photos at a time.");
    const location = await findOrCreateLocation(ctx, args.locationName);
    const now = Date.now();
    const draft = {
      title: "Identifying item…",
      description: "",
      category: "Uncategorised",
      tags: [] as string[],
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
    await ctx.scheduler.runAfter(0, internal.inventoryAi.enrich, { itemId });
    return itemId;
  },
});

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(inventoryStatus),
    locationId: v.optional(v.id("inventoryLocations")),
  },
  returns: v.object({ page: v.array(itemSummary), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    await requireInventoryUser(ctx);
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
  },
});

export const get = query({
  args: { itemId: v.id("inventoryItems") },
  returns: v.union(v.null(), v.object({
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
  })),
  handler: async (ctx, args) => {
    await requireInventoryUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const [photos, events] = await Promise.all([
      ctx.db.query("inventoryPhotos").withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", args.itemId)).take(50),
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
  },
});

export const updateDetails = mutation({
  args: {
    itemId: v.id("inventoryItems"), title: v.string(), description: v.string(), category: v.string(),
    tags: v.array(v.string()), condition: v.string(), quantity: v.number(), attributes: v.array(attribute),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireInventoryUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found.");
    const details = {
      title: args.title.trim() || "Untitled item", description: args.description.trim(),
      category: args.category.trim() || "Uncategorised", tags: args.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 30),
      condition: args.condition.trim() || "Unknown", quantity: Math.max(1, Math.floor(args.quantity)),
      attributes: args.attributes.map(({ label, value }) => ({ label: label.trim(), value: value.trim() })).filter(({ label, value }) => label && value).slice(0, 40),
      currentLocationName: item.currentLocationName,
    };
    await ctx.db.patch(args.itemId, { ...details, searchText: buildSearchText(details), updatedAt: Date.now() });
    await ctx.db.insert("inventoryEvents", { itemId: args.itemId, type: "edited", actorId: userId, occurredAt: Date.now() });
    return null;
  },
});

export const move = mutation({
  args: { itemId: v.id("inventoryItems"), locationName: v.string(), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireInventoryUser(ctx);
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
  },
});

export const setStatus = mutation({
  args: { itemId: v.id("inventoryItems"), status: inventoryStatus, note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireInventoryUser(ctx);
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
  },
});

export const addPhotos = mutation({
  args: { itemId: v.id("inventoryItems"), storageIds: v.array(v.id("_storage")), rerunEnrichment: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireInventoryUser(ctx);
    if (args.storageIds.length === 0 || args.storageIds.length > 8) throw new Error("Add between one and eight photos.");
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found.");
    const lastPhoto = await ctx.db.query("inventoryPhotos")
      .withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", args.itemId)).order("desc").first();
    const startSortOrder = (lastPhoto?.sortOrder ?? -1) + 1;
    const now = Date.now();
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
      ...(args.rerunEnrichment ? { enrichmentStatus: "queued" as const, enrichmentError: undefined } : {}),
    });
    if (args.rerunEnrichment) await ctx.scheduler.runAfter(0, internal.inventoryAi.enrich, { itemId: args.itemId });
    return null;
  },
});
