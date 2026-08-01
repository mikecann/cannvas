import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericActionCtx, GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";

type InventoryCtx =
  | GenericQueryCtx<DataModel>
  | GenericMutationCtx<DataModel>
  | GenericActionCtx<DataModel>;

export async function requireInventoryUser(ctx: InventoryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You need to sign in to use the inventory.");

  // Actions cannot read the database directly, so their callers should validate
  // access in a query/mutation before scheduling them.
  if ("db" in ctx) {
    const access = await ctx.db
      .query("inventoryAccess")
      .withIndex("by_user_id", (q) => q.eq("userId", userId))
      .unique();
    if (!access) throw new Error("This account does not have inventory access.");
  }

  return userId;
}
