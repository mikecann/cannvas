"use node";

import { Agent } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { stepCountIs } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { components, internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const MODEL = "gpt-5.6-luna";

const researcher = new Agent(components.agent, {
  name: "Cannvas inventory researcher",
  languageModel: openai.responses(MODEL),
  instructions: [
    "Identify household inventory from photographs.",
    "Inspect visible labels, connectors, dimensions, model numbers, packaging and condition.",
    "Use web search only when a visible identifier or distinctive design can materially improve the identification.",
    "Never invent a model number, serial number, specification or source.",
    "Explain uncertainty plainly and keep the research notes concise.",
  ].join(" "),
  tools: { webSearch: openai.tools.webSearch({ searchContextSize: "low" }) },
  stopWhen: stepCountIs(3),
});

const structurer = new Agent(components.agent, {
  name: "Cannvas inventory cataloguer",
  languageModel: openai.responses(MODEL),
  instructions: [
    "Create a useful generic household inventory record from photos and research notes.",
    "Prefer a specific human-readable title, but qualify uncertainty rather than guessing.",
    "Use category names that remain useful across electronics, tools, furniture, documents, clothing and household goods.",
    "Put product-specific facts such as brand, model, dimensions, connector, material or serial number into attributes.",
    "Do not include the storage location in the generated description or tags.",
    "Set needsReview when the exact identity is uncertain, the photos are unclear, multiple different objects may be present, or important visible details conflict.",
    "Give a short reviewReason that tells the owner exactly what to check. Leave reviewReason empty when no review is needed.",
  ].join(" "),
});

const enrichmentSchema = z.object({
  title: z.string(),
  description: z.string(),
  category: z.string(),
  tags: z.array(z.string()).max(20),
  condition: z.string(),
  quantity: z.number().int().positive(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })).max(30),
  needsReview: z.boolean(),
  reviewReason: z.string(),
});

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export const enrich = internalAction({
  args: { itemId: v.id("inventoryItems") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.inventoryAiStore.markProcessing, { itemId: args.itemId });
    try {
      if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is not configured.");
      const context = await ctx.runQuery(internal.inventoryAiStore.getContext, { itemId: args.itemId });
      if (!context || context.photoUrls.length === 0) throw new Error("No inventory photos are available.");

      const imageParts = context.photoUrls.map((image) => ({ type: "image" as const, image }));
      const { threadId } = await researcher.createThread(ctx, { userId: `inventory:${args.itemId}` });
      const research = await researcher.generateText(ctx, { threadId }, {
        prompt: [{
          role: "user",
          content: [
            {
              type: "text",
              text: "Identify this item from all supplied angles. Research visible brands or identifiers when useful. Return concise evidence-led notes for another cataloguing step.",
            },
            ...imageParts,
          ],
        }],
      });

      const structured = await structurer.generateObject(ctx, { threadId }, {
        prompt: [{
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `Research notes:\n${research.text}`,
                `Existing location (context only, do not copy into the record): ${context.item.currentLocationName}`,
                "Create the final inventory record. If the exact identity is uncertain, keep the title and description honest but still useful.",
              ].join("\n\n"),
            },
            ...imageParts,
          ],
        }],
        schema: enrichmentSchema,
      });

      const sources = research.sources
        .filter((source) => source.sourceType === "url")
        .map((source) => ({ title: source.title ?? source.url, url: source.url }));
      await ctx.runMutation(internal.inventoryAiStore.applyEnrichment, {
        itemId: args.itemId,
        enrichment: structured.object,
        model: MODEL,
        sources,
      });
    } catch (error) {
      await ctx.runMutation(internal.inventoryAiStore.markFailed, {
        itemId: args.itemId,
        error: errorMessage(error),
      });
    }
    return null;
  },
});
