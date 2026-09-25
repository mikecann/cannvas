import type { Chore, Completion, Stroke, TabletCompletion, TabletSchedule, Todo } from "../data/types";

// Convex documents max out at 1 MiB. The server enforces the same limit.
export const MAX_BACKUP_JSON_LENGTH = 900_000;
// Must match MAX_REVISION in convex/deviceBackups.ts.
export const MAX_BACKUP_REVISION = 1_000_000_000_000;

export function isValidRevision(revision: unknown): revision is number {
  return typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 && revision <= MAX_BACKUP_REVISION;
}

export type BackupSource = {
  revision: number;
  tabletScheduleVersion: number;
  updatedAt: number;
  boards: Record<string, Stroke[]>;
  boardRevisions?: Record<string, number>;
  chores: Chore[];
  completions: Completion[];
  todos: Todo[];
  tabletSchedules: TabletSchedule[];
  tabletCompletions: TabletCompletion[];
};

function withOptional<T extends object, K extends string, V>(value: T, key: K, optional: V | undefined) {
  return optional === undefined ? value : { ...value, [key]: optional };
}

// Pick exact fields so an old or odd localStorage value can never fail the
// server's validator and stop every later backup.
export function toBackupState(state: BackupSource) {
  return {
    version: 3 as const,
    tabletScheduleVersion: state.tabletScheduleVersion,
    revision: state.revision,
    updatedAt: state.updatedAt,
    chores: state.chores.map(({ id, name, valueCents, category, color, position }) => ({
      // The server only accepts these two. Anything else would block every backup.
      id, name, valueCents, category: category === "bonus" ? "bonus" as const : "standard" as const, color, position,
    })),
    completions: state.completions.map(({ choreId, date }) => ({ choreId, date })),
    todos: state.todos.map(({ id, title, assignee, priority, dueDate, completed, createdAt }) =>
      withOptional({ id, title, assignee, priority, completed, createdAt }, "dueDate", dueDate)),
    tabletSchedules: state.tabletSchedules.map(({ id, name, purpose, cadenceMonths, color, dueDate }) =>
      withOptional({ id, name, purpose, cadenceMonths, color }, "dueDate", dueDate)),
    tabletCompletions: state.tabletCompletions.map(({ id, tabletId, takenDate, previousDueDate }) =>
      withOptional({ id, tabletId, takenDate }, "previousDueDate", previousDueDate)),
  };
}

export type BackupState = ReturnType<typeof toBackupState>;

// Identifies the backed-up content, ignoring the counters that change on
// every edit. A board edit alone does not need a new device backup write.
export function backupContentKey(payload: BackupState) {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = payload;
  return JSON.stringify(content);
}

export function toBackupStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map(({ id, kind, color, width, points, sticker }) => {
    const stroke: Stroke = { id, color, width, points: points.map(({ x, y }) => ({ x, y })) };
    if (kind !== undefined) stroke.kind = kind;
    if (sticker !== undefined) stroke.sticker = sticker;
    return stroke;
  });
}

// Boards saved before per-board revisions existed count as revision 1, so
// each one is uploaded once.
export function boardRevision(state: Pick<BackupSource, "boardRevisions">, date: string) {
  return state.boardRevisions?.[date] ?? 1;
}

export function boardsNeedingBackup(
  state: Pick<BackupSource, "boards" | "boardRevisions">,
  backedUp: Record<string, number>,
  skip: ReadonlySet<string> = new Set(),
) {
  return Object.keys(state.boards)
    .filter((date) => !skip.has(date) && boardRevision(state, date) > (backedUp[date] ?? -1))
    .sort();
}

// Compare the kiosk's boards with what the server actually holds.
// - Boards the server doesn't have (or holds at a lower revision) get uploaded.
// - Boards the server holds at a higher revision are moved past it, because
//   the kiosk's copy is the authority.
// - The device revision ends up at least as high as every board revision, so
//   the next edit always produces a revision the server will accept.
export function reconcileBoardRevisions(
  state: Pick<BackupSource, "revision" | "boards" | "boardRevisions">,
  server: Record<string, number>,
) {
  const boardRevisions: Record<string, number> = { ...state.boardRevisions };
  const backedUp: Record<string, number> = {};
  let revision = state.revision;
  for (const date of Object.keys(state.boards)) {
    const local = boardRevision(state, date);
    revision = Math.max(revision, local);
    const remote = server[date];
    // A server revision above the cap is treated as missing, like the server does.
    if (!isValidRevision(remote)) continue;
    if (remote > local) {
      boardRevisions[date] = remote + 1;
      revision = Math.max(revision, remote + 1);
    } else {
      backedUp[date] = remote;
    }
  }
  return { revision, boardRevisions, backedUp };
}

// UTF-8 bytes, which is what counts against Convex's document limit.
export function jsonLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function backupRetryDelayMs(failures: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, failures - 1));
}
