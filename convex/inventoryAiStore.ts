import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const enrichment = v.object({
  title: v.string(),
  description: v.string(),
  category: v.string(),
  tags: v.array(v.string()),
  condition: v.string(),
  quantity: v.number(),
  attributes: v.array(v.object({ label: v.string(), value: v.string() })),
  needsReview: v.boolean(),
  reviewReason: v.string(),
});

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
    item.title, item.description, item.category, item.condition, item.currentLocationName,
    ...item.tags, ...item.attributes.flatMap(({ label, value }) => [label, value]),
  ].join(" ");
}

export const getContext = internalQuery({
  args: { itemId: v.id("inventoryItems") },
  returns: v.union(v.null(), v.object({
    item: v.object({
      title: v.string(), description: v.string(), category: v.string(), tags: v.array(v.string()),
      condition: v.string(), quantity: v.number(), attributes: v.array(v.object({ label: v.string(), value: v.string() })),
      currentLocationName: v.string(),
    }),
    photoUrls: v.array(v.string()),
  })),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const photos = await ctx.db
      .query("inventoryPhotos")
      .withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", args.itemId))
      .take(20);
    const photoUrls = await Promise.all(
      photos.map((photo) => ctx.storage.getUrl(photo.storageId)),
    );
    return {
      item: {
        title: item.title, description: item.description, category: item.category, tags: item.tags,
        condition: item.condition, quantity: item.quantity, attributes: item.attributes,
        currentLocationName: item.currentLocationName,
      },
      photoUrls: photoUrls.filter((url): url is string => url !== null),
    };
  },
});

export const markProcessing = internalMutation({
  args: { itemId: v.id("inventoryItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (item) await ctx.db.patch(args.itemId, { enrichmentStatus: "processing", enrichmentError: undefined });
    return null;
  },
});

export const applyEnrichment = internalMutation({
  args: {
    itemId: v.id("inventoryItems"),
    enrichment,
    model: v.string(),
    sources: v.array(v.object({ title: v.string(), url: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const reviewReason = args.enrichment.reviewReason.trim();
    const tags = args.enrichment.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 28);
    if (item.tags.some((tag) => tag.toLocaleLowerCase("en-AU") === "box only")) tags.push("box only");
    if (args.enrichment.needsReview) tags.push("needs review");
    const attributes = args.enrichment.attributes
      .map(({ label, value }) => ({ label: label.trim(), value: value.trim() }))
      .filter(({ label, value }) => label && value && label.toLocaleLowerCase("en-AU") !== "review note")
      .slice(0, args.enrichment.needsReview && reviewReason ? 39 : 40);
    if (args.enrichment.needsReview && reviewReason) {
      attributes.push({ label: "Review note", value: reviewReason });
    }
    const details = {
      title: args.enrichment.title.trim() || "Unidentified item",
      description: args.enrichment.description.trim(),
      category: args.enrichment.category.trim() || "Uncategorised",
      tags: [...new Set(tags)].slice(0, 30),
      condition: args.enrichment.condition.trim() || "Unknown",
      quantity: Math.max(1, Math.floor(args.enrichment.quantity)),
      attributes,
      currentLocationName: item.currentLocationName,
    };
    const now = Date.now();
    await ctx.db.patch(args.itemId, {
      ...details,
      enrichmentStatus: "ready",
      enrichmentError: undefined,
      aiModel: args.model,
      aiSources: args.sources.slice(0, 12),
      searchText: buildSearchText(details),
      updatedAt: now,
    });
    await ctx.db.insert("inventoryEvents", {
      itemId: args.itemId,
      type: "ai_enriched",
      note: args.enrichment.needsReview
        ? `${args.model} identified the item and marked it for review`
        : `${args.model} identified the item`,
      occurredAt: now,
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { itemId: v.id("inventoryItems"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const now = Date.now();
    await ctx.db.patch(args.itemId, {
      enrichmentStatus: "failed",
      enrichmentError: args.error.slice(0, 500),
      updatedAt: now,
    });
    await ctx.db.insert("inventoryEvents", {
      itemId: args.itemId,
      type: "ai_failed",
      note: args.error.slice(0, 300),
      occurredAt: now,
    });
    return null;
  },
});
