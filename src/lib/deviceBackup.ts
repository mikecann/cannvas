import type { Chore, Completion, Stroke, TabletCompletion, TabletSchedule, Todo } from "../data/types";

// Convex documents max out at 1 MiB. The server enforces the same limit.
export const MAX_BACKUP_JSON_LENGTH = 900_000;

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
      id, name, valueCents, category: category ?? "standard", color, position,
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
    .filter((date) => !skip.has(date) && boardRevision(state, date) > (backedUp[date] ?? 0))
    .sort();
}

export function jsonLength(value: unknown) {
  return JSON.stringify(value).length;
}

export function backupRetryDelayMs(failures: number) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, failures - 1));
}
