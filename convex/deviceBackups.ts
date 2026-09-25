import { ConvexError, v, type Infer } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { deviceMutation, deviceQuery } from "./fluent";
import { deviceState, stroke } from "./lib/validators";

// Convex documents max out at 1 MiB. Leave headroom for field overhead.
export const MAX_BACKUP_JSON_LENGTH = 900_000;
// Revisions are a local counter that goes up by one per change. Anything
// beyond this is a bug, and accepting it would block every later backup.
const MAX_REVISION = 1_000_000_000_000;

const saveResult = v.object({ accepted: v.boolean(), revision: v.number() });

export function assertRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > MAX_REVISION) {
    throw new ConvexError("Backup revision is out of range.");
  }
}

export function assertBackupSize(value: unknown, label: string) {
  // UTF-8 bytes, which is what counts against the document limit.
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BACKUP_JSON_LENGTH) {
    throw new ConvexError(`${label} is too large to back up.`);
  }
}

type Stroke = Infer<typeof stroke>;

function sanitizeLegacyStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): Stroke[] => {
    const item = candidate as Partial<Stroke> | null;
    if (!item || typeof item.id !== "string" || typeof item.color !== "string" || typeof item.width !== "number" || !Array.isArray(item.points)) {
      return [];
    }
    const points = item.points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(({ x, y }) => ({ x, y }));
    return [{
      id: item.id,
      ...(item.kind === "stroke" || item.kind === "sticker" ? { kind: item.kind } : {}),
      color: item.color,
      width: item.width,
      points,
      ...(typeof item.sticker === "string" ? { sticker: item.sticker } : {}),
    }];
  });
}

// Older kiosk builds kept every whiteboard inside the device backup. Before
// the first new-format save replaces that document, copy those boards into
// deviceBoards so the only server copy is never dropped.
async function moveInlineBoards(ctx: MutationCtx, deviceId: string, state: unknown) {
  const boards = (state as { boards?: unknown } | null)?.boards;
  if (!boards || typeof boards !== "object") return;
  for (const [date, strokes] of Object.entries(boards as Record<string, unknown>)) {
    const existing = await ctx.db
      .query("deviceBoards")
      .withIndex("by_device_id_and_date", (q) => q.eq("deviceId", deviceId).eq("date", date))
      .unique();
    if (existing) continue;
    await ctx.db.insert("deviceBoards", {
      deviceId,
      date,
      revision: 0,
      strokes: sanitizeLegacyStrokes(strokes),
      updatedAt: Date.now(),
    });
  }
}

export const getRevision = deviceQuery
  .input({ deviceId: v.string() })
  .returns(v.union(v.null(), v.object({ revision: v.number(), updatedAt: v.number() })))
  .handler(async (ctx, args) => {
    const backup = await ctx.db
      .query("deviceBackups")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .unique();
    return backup ? { revision: backup.revision, updatedAt: backup.updatedAt } : null;
  })
  .public();

// Only used to rebuild a kiosk that has lost its local storage.
export const get = deviceQuery
  .input({ deviceId: v.string() })
  .returns(v.union(v.null(), v.object({ revision: v.number(), state: v.any(), updatedAt: v.number() })))
  .handler(async (ctx, args) => {
    const backup = await ctx.db
      .query("deviceBackups")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .unique();
    if (!backup) return null;
    return { revision: backup.revision, state: backup.state, updatedAt: backup.updatedAt };
  })
  .public();

export const save = deviceMutation
  .input({
    deviceId: v.string(),
    revision: v.number(),
    state: deviceState,
  })
  .returns(saveResult)
  .handler(async (ctx, args) => {
    assertRevision(args.revision);
    assertBackupSize(args.state, "The device backup");
    const existing = await ctx.db
      .query("deviceBackups")
      .withIndex("by_device_id", (q) => q.eq("deviceId", args.deviceId))
      .unique();

    // Rapid edits can leave several requests in flight. Never let an older
    // response arrive late and replace a newer device snapshot. The kiosk
    // moves its revision past a rejected one and saves again.
    if (existing && args.revision <= existing.revision) {
      return { accepted: false, revision: existing.revision };
    }

    const value = { revision: args.revision, state: args.state, updatedAt: Date.now() };
    if (existing) {
      await moveInlineBoards(ctx, args.deviceId, existing.state);
      await ctx.db.patch(existing._id, value);
    } else {
      await ctx.db.insert("deviceBackups", { deviceId: args.deviceId, ...value });
    }
    return { accepted: true, revision: args.revision };
  })
  .public();
