import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

const kioskInventoryItem = v.object({
  _id: v.id("inventoryItems"),
  title: v.string(),
  category: v.string(),
  condition: v.string(),
  quantity: v.number(),
  currentLocationName: v.string(),
  updatedAt: v.number(),
  photoUrl: v.union(v.string(), v.null()),
});

// The public client cannot call this query. The mirror reaches it through the
// token-protected HTTP route, which keeps household locations off the internet.
export const listForMirror = internalQuery({
  args: {},
  returns: v.array(kioskInventoryItem),
  handler: async (ctx) => {
    const items = await ctx.db
      .query("inventoryItems")
      .withIndex("by_status_and_updated_at", (q) => q.eq("status", "active"))
      .order("desc")
      .take(200);

    return Promise.all(items.map(async (item) => {
      const photo = await ctx.db
        .query("inventoryPhotos")
        .withIndex("by_item_id_and_sort_order", (q) => q.eq("itemId", item._id))
        .first();
      return {
        _id: item._id,
        title: item.title,
        category: item.category,
        condition: item.condition,
        quantity: item.quantity,
        currentLocationName: item.currentLocationName,
        updatedAt: item.updatedAt,
        photoUrl: photo ? await ctx.storage.getUrl(photo.storageId) : null,
      };
    }));
  },
});
