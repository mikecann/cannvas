"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

export const claim = action({
  args: { setupToken: v.string() },
  returns: v.object({ role: v.union(v.literal("owner"), v.literal("member")) }),
  handler: async (ctx, args): Promise<{ role: "owner" | "member" }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in before claiming inventory access.");

    const expected = process.env.INVENTORY_SETUP_TOKEN?.trim();
    if (!expected) throw new Error("INVENTORY_SETUP_TOKEN is not configured.");
    if (args.setupToken.trim() !== expected) throw new Error("That setup code is not valid.");

    return ctx.runMutation(internal.inventoryAccessStore.grant, { userId });
  },
});
