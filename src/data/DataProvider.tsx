import {
  createContext,
  type Dispatch,
  type PropsWithChildren,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConvexProvider, ConvexReactClient, useAction, useConvex, useMutation, useQueries } from "convex/react";
import { makeUseQueryWithStatus } from "convex-helpers/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  backupContentKey,
  backupRetryDelayMs,
  boardRevision,
  boardsNeedingBackup,
  isValidRevision,
  jsonLength,
  MAX_BACKUP_JSON_LENGTH,
  reconcileBoardRevisions,
  toBackupState,
  toBackupStrokes,
} from "../lib/deviceBackup";
import { compactStrokes } from "../lib/strokes";
import type { BackupStatus, CalendarEvent, CalendarStatus, CannvasData, Chore, ChoreCategory, Completion, NewsHeadline, Stroke, TabletCompletion, TabletSchedule, Todo } from "./types";

const DataContext = createContext<CannvasData | null>(null);
const DEVICE_STORAGE_KEY = "cannvas-device-data-v2";
const LEGACY_LOCAL_STORAGE_KEY = "cannvas-local-data-v1";
const DEVICE_ID = import.meta.env.VITE_CANNVAS_DEVICE_ID
  ?? (import.meta.env.PROD ? "mirror" : "development");
// Only the kiosk build on the Pi has this. The public site is a separate build
// that never includes this module.
const DEVICE_TOKEN = import.meta.env.VITE_CANNVAS_DEVICE_TOKEN?.trim() ?? "";
const BACKUP_DEBOUNCE_MS = 500;
const RECOVERY_PAGE_SIZE = 50;
const CALENDAR_CACHE_KEY = "cannvas-calendar-cache-v1";
const CALENDAR_REQUEST_TIMEOUT_MS = 30_000;
const CALENDAR_RETRY_MS = 60_000;
const CALENDAR_REFRESH_MS = 15 * 60_000;
const CALENDAR_RELOAD_COOLDOWN_MS = 10 * 60_000;
const CALENDAR_RELOAD_KEY = "cannvas-calendar-reload-at";
const TABLET_SCHEDULE_VERSION = 1;
const COLORS = ["#ff8066", "#ffbf47", "#5ec6a5", "#6ba7ff", "#a77bea", "#ff7eb3"];
const PREVIEW_HEADLINES: NewsHeadline[] = [
  { title: "World headlines will update automatically", url: "https://www.bbc.com/news/world" },
  { title: "The news source can be changed later", url: "https://www.bbc.com/news/world" },
  { title: "Fresh stories appear throughout the day", url: "https://www.bbc.com/news/world" },
];
const INITIAL_TABLET_HISTORY: TabletCompletion[] = [
  { id: "history-nuheart-2025-08-20", tabletId: "nuheart", takenDate: "2025-08-20" },
  { id: "history-milbemax-2025-09-20", tabletId: "milbemax", takenDate: "2025-09-20" },
  { id: "history-bravecto-2025-09-25", tabletId: "bravecto", takenDate: "2025-09-25" },
  { id: "history-nuheart-2025-10-20", tabletId: "nuheart", takenDate: "2025-10-20" },
  { id: "history-nuheart-2025-11-20", tabletId: "nuheart", takenDate: "2025-11-20" },
  { id: "history-milbemax-2025-12-20", tabletId: "milbemax", takenDate: "2025-12-20" },
  { id: "history-bravecto-2025-12-25", tabletId: "bravecto", takenDate: "2025-12-25" },
  { id: "history-nuheart-2026-01-20", tabletId: "nuheart", takenDate: "2026-01-20" },
  { id: "history-nuheart-2026-02-20", tabletId: "nuheart", takenDate: "2026-02-20" },
  { id: "history-milbemax-2026-03-20", tabletId: "milbemax", takenDate: "2026-03-20" },
  { id: "history-bravecto-2026-03-25", tabletId: "bravecto", takenDate: "2026-03-25" },
  { id: "history-nuheart-2026-04-20", tabletId: "nuheart", takenDate: "2026-04-20" },
];

function previewCalendarEvents(): CalendarEvent[] {
  const at = (offset: number, hour: number, minute = 0) => {
    const value = new Date();
    value.setHours(hour, minute, 0, 0);
    value.setDate(value.getDate() + offset);
    return value.toISOString();
  };
  return [
    { id: "preview-school", title: "School assembly", start: at(0, 9), end: at(0, 10), allDay: false },
    { id: "preview-soccer", title: "Joshie Soccer", start: at(1, 15, 15), end: at(1, 16), allDay: false },
    { id: "preview-dinner", title: "Family dinner", start: at(3, 18), end: at(3, 19, 30), allDay: false },
    { id: "preview-doctor", title: "Doctor appointment", start: at(6, 11, 15), end: at(6, 11, 45), allDay: false },
  ];
}

function readCalendarCache(): CalendarEvent[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(CALENDAR_CACHE_KEY) ?? "[]") as CalendarEvent[];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function hasCurrentCalendarEvents(events: CalendarEvent[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return events.some((event) => new Date(event.end) > today);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(() => reject(new Error("Calendar request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

type LocalState = {
  boards: Record<string, Stroke[]>;
  chores: Chore[];
  completions: Completion[];
  todos: Todo[];
  tabletSchedules: TabletSchedule[];
  tabletCompletions: CannvasData["tabletCompletions"];
};

type DeviceState = LocalState & {
  // The device revision at which each board last changed. Boards are backed
  // up one document per date, so this says which ones need uploading.
  boardRevisions: Record<string, number>;
  version: 2;
  tabletScheduleVersion: number;
  revision: number;
  updatedAt: number;
};

type ConvexChore = Omit<Chore, "category"> & { category?: ChoreCategory; _id: string };
type TodoData = Pick<
  CannvasData,
  "todos" | "addTodo" | "updateTodo" | "toggleTodo" | "removeTodo" | "isReady"
>;

function createInitialLocalState(): LocalState {
  return {
    boards: {},
    chores: [
      { id: "make-bed", name: "Make my bed", valueCents: 50, category: "standard", color: COLORS[0], position: 0 },
      { id: "feed-pets", name: "Feed the pets", valueCents: 50, category: "standard", color: COLORS[2], position: 1 },
      { id: "tidy-room", name: "Tidy my room", valueCents: 100, category: "standard", color: COLORS[3], position: 2 },
    ],
    completions: [],
    todos: [],
    tabletSchedules: [
      { id: "nuheart", name: "Nuheart", purpose: "Heartworm", cadenceMonths: 1, color: "#ed6a5a", dueDate: "2026-08-20" },
      { id: "milbemax", name: "Milbemax", purpose: "Intestinal worms", cadenceMonths: 3, color: "#5f8fda", dueDate: "2026-09-20" },
      { id: "bravecto", name: "Bravecto", purpose: "Fleas and ticks", cadenceMonths: 3, color: "#8c6bc7", dueDate: "2026-09-25" },
    ],
    tabletCompletions: INITIAL_TABLET_HISTORY,
  };
}

function toDeviceState(value: Partial<LocalState & Pick<DeviceState, "revision" | "tabletScheduleVersion" | "boardRevisions">>): DeviceState {
  const fallback = createInitialLocalState();
  const needsTabletScheduleMigration = value.tabletScheduleVersion !== TABLET_SCHEDULE_VERSION;
  return {
    version: 2,
    tabletScheduleVersion: TABLET_SCHEDULE_VERSION,
    // Older builds accepted any revision. One past the server's cap would be
    // rejected on every save, so start again from 0 and let the server's
    // answer move it forward.
    revision: isValidRevision(value.revision) ? value.revision : 0,
    updatedAt: Date.now(),
    boards: value.boards ?? fallback.boards,
    boardRevisions: isValidRevision(value.revision) && value.boardRevisions && typeof value.boardRevisions === "object"
      ? Object.fromEntries(Object.entries(value.boardRevisions).filter(([, revision]) => isValidRevision(revision)))
      : {},
    chores: (value.chores ?? fallback.chores).map((chore) => ({
      ...chore,
      category: chore.category ?? "standard",
    })),
    completions: value.completions ?? fallback.completions,
    // Older device snapshots pre-date To-do's. An empty list migrates them
    // without replacing any device-owned data with a remote default.
    todos: value.todos ?? fallback.todos,
    tabletSchedules: fallback.tabletSchedules.map((defaultSchedule) => {
      const stored = value.tabletSchedules?.find(({ id }) => id === defaultSchedule.id);
      // Seed Mike's agreed schedule once, then preserve any future manual
      // adjustment made from the date picker.
      return {
        ...defaultSchedule,
        dueDate: needsTabletScheduleMigration ? defaultSchedule.dueDate : stored?.dueDate,
      };
    }),
    tabletCompletions: [
      ...INITIAL_TABLET_HISTORY,
      ...(value.tabletCompletions ?? []).filter(({ id }) => !INITIAL_TABLET_HISTORY.some((entry) => entry.id === id)),
    ],
  };
}

function addMonthsToDateKey(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const result = new Date(targetYear, normalizedMonth, Math.min(day, lastDay));
  return [result.getFullYear(), String(result.getMonth() + 1).padStart(2, "0"), String(result.getDate()).padStart(2, "0")].join("-");
}

function nextTabletDueDate(tablet: TabletSchedule): string | undefined {
  if (!tablet.dueDate) return undefined;

  let nextDate = addMonthsToDateKey(tablet.dueDate, tablet.cadenceMonths);
  if (tablet.id !== "nuheart") return nextDate;

  // Milbemax is given on the 20th in March, June, September and December.
  // It replaces Nuheart in those months, so advance to the following month.
  const month = Number(nextDate.slice(5, 7));
  if (month % 3 === 0) nextDate = addMonthsToDateKey(nextDate, 1);
  return nextDate;
}

function readStoredState(key: string): DeviceState | null {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? toDeviceState(JSON.parse(stored) as Partial<DeviceState>) : null;
  } catch {
    return null;
  }
}

function writeDeviceState(state: DeviceState) {
  window.localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(state));
}

function useDeviceData(
  state: DeviceState | null,
  setState: Dispatch<SetStateAction<DeviceState | null>>,
  newsHeadlines: NewsHeadline[],
  calendarEvents: CalendarEvent[],
  calendarStatus: CalendarStatus,
  loadCalendarRange: (start: string, end: string) => Promise<void>,
  mode: CannvasData["mode"],
  backupStatus: BackupStatus,
  todoData?: TodoData,
): CannvasData {
  const updateState = useCallback((update: (current: DeviceState) => LocalState & Partial<Pick<DeviceState, "boardRevisions">>) => {
    setState((current) => {
      if (!current) return current;
      const next = update(current);
      return {
        ...next,
        boardRevisions: next.boardRevisions ?? current.boardRevisions,
        version: 2,
        tabletScheduleVersion: current.tabletScheduleVersion,
        revision: current.revision + 1,
        updatedAt: Date.now(),
      };
    });
  }, [setState]);

  const visibleState = state ?? toDeviceState({});

  return useMemo<CannvasData>(() => ({
    boardDates: Object.entries(visibleState.boards)
      .filter(([, strokes]) => strokes.length > 0)
      .map(([date]) => date),
    getBoard: (date) => visibleState.boards[date] ?? [],
    saveBoard: async (date, strokes) => {
      updateState((current) => ({
        ...current,
        boards: { ...current.boards, [date]: compactStrokes(strokes) },
        boardRevisions: { ...current.boardRevisions, [date]: current.revision + 1 },
      }));
    },
    chores: visibleState.chores,
    completions: visibleState.completions,
    tabletSchedules: visibleState.tabletSchedules,
    tabletCompletions: visibleState.tabletCompletions,
    todos: todoData?.todos ?? visibleState.todos,
    newsHeadlines,
    calendarEvents,
    calendarStatus,
    loadCalendarRange,
    addChore: async (name, valueCents, category) => {
      updateState((current) => ({
        ...current,
        chores: [...current.chores, {
          id: crypto.randomUUID(),
          name,
          valueCents,
          category,
          color: COLORS[current.chores.length % COLORS.length],
          position: current.chores.length,
        }],
      }));
    },
    updateChore: async (id, name, valueCents, category) => {
      updateState((current) => ({
        ...current,
        chores: current.chores.map((chore) => chore.id === id ? { ...chore, name, valueCents, category } : chore),
      }));
    },
    removeChore: async (id) => {
      updateState((current) => ({
        ...current,
        chores: current.chores.filter((chore) => chore.id !== id),
        completions: current.completions.filter((completion) => completion.choreId !== id),
      }));
    },
    toggleCompletion: async (choreId, date) => {
      updateState((current) => {
        const exists = current.completions.some(
          (completion) => completion.choreId === choreId && completion.date === date,
        );
        return {
          ...current,
          completions: exists
            ? current.completions.filter(
                (completion) => !(completion.choreId === choreId && completion.date === date),
              )
            : [...current.completions, { choreId, date }],
        };
      });
    },
    clearWeek: async (weekStart) => {
      const start = new Date(`${weekStart}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      updateState((current) => ({
        ...current,
        completions: current.completions.filter(({ date }) => {
          const value = new Date(`${date}T00:00:00`);
          return value < start || value >= end;
        }),
      }));
    },
    setTabletDueDate: async (tabletId, dueDate) => {
      updateState((current) => ({
        ...current,
        tabletSchedules: current.tabletSchedules.map((tablet) => tablet.id === tabletId
          ? { ...tablet, dueDate: dueDate || undefined }
          : tablet),
      }));
    },
    completeTablet: async (tabletId, takenDate) => {
      updateState((current) => {
        const tablet = current.tabletSchedules.find(({ id }) => id === tabletId);
        if (!tablet) return current;
        return {
          ...current,
          tabletSchedules: current.tabletSchedules.map((candidate) => candidate.id === tabletId
            ? { ...candidate, dueDate: nextTabletDueDate(candidate) }
            : candidate),
          tabletCompletions: [...current.tabletCompletions, {
            id: crypto.randomUUID(),
            tabletId,
            takenDate,
            previousDueDate: tablet.dueDate,
          }],
        };
      });
    },
    undoTabletCompletion: async (tabletId) => {
      updateState((current) => {
        const latest = [...current.tabletCompletions].reverse().find((completion) => completion.tabletId === tabletId);
        if (!latest) return current;
        return {
          ...current,
          tabletSchedules: current.tabletSchedules.map((tablet) => tablet.id === tabletId
            ? { ...tablet, dueDate: latest.previousDueDate }
            : tablet),
          tabletCompletions: current.tabletCompletions.filter(({ id }) => id !== latest.id),
        };
      });
    },
    addTodo: todoData?.addTodo ?? (async (title, assignee, priority, dueDate) => {
      updateState((current) => ({
        ...current,
        todos: [...current.todos, {
          id: crypto.randomUUID(),
          title,
          assignee,
          priority,
          dueDate: dueDate || undefined,
          completed: false,
          createdAt: Date.now(),
        }],
      }));
    }),
    updateTodo: todoData?.updateTodo ?? (async (id, title, assignee, priority, dueDate) => {
      updateState((current) => ({
        ...current,
        todos: current.todos.map((todo) => todo.id === id
          ? { ...todo, title, assignee, priority, dueDate: dueDate || undefined }
          : todo),
      }));
    }),
    toggleTodo: todoData?.toggleTodo ?? (async (id) => {
      updateState((current) => ({
        ...current,
        todos: current.todos.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo),
      }));
    }),
    removeTodo: todoData?.removeTodo ?? (async (id) => {
      updateState((current) => ({
        ...current,
        todos: current.todos.filter((todo) => todo.id !== id),
      }));
    }),
    isReady: state !== null && (todoData?.isReady ?? true),
    backupStatus,
    mode,
  }), [backupStatus, calendarEvents, calendarStatus, loadCalendarRange, mode, newsHeadlines, state, todoData, updateState, visibleState]);
}

const LOCAL_BACKUP_STATUS: BackupStatus = { state: "local" };

function LocalDataProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<DeviceState | null>(() =>
    readStoredState(DEVICE_STORAGE_KEY)
    ?? readStoredState(LEGACY_LOCAL_STORAGE_KEY)
    ?? toDeviceState({}),
  );

  useEffect(() => {
    if (state) writeDeviceState(state);
  }, [state]);

  const calendarEvents = useMemo(previewCalendarEvents, []);
  const loadCalendarRange = useCallback(async () => undefined, []);
  const data = useDeviceData(state, setState, PREVIEW_HEADLINES, calendarEvents, "ready", loadCalendarRange, "local", LOCAL_BACKUP_STATUS);
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

const useQueryWithStatus = makeUseQueryWithStatus(useQueries);

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") return error.data;
  return error instanceof Error ? error.message : String(error);
}

async function collectPages<T>(
  loadPage: (cursor: string | null) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const result = await loadPage(cursor);
    rows.push(...result.page);
    if (result.isDone) return rows;
    cursor = result.continueCursor;
  }
}

async function loadServerBoardRevisions(client: ConvexReactClient) {
  const rows = await collectPages((cursor) => client.query(api.deviceBoards.revisions, {
    deviceToken: DEVICE_TOKEN,
    deviceId: DEVICE_ID,
    paginationOpts: { cursor, numItems: 200 },
  }));
  return Object.fromEntries(rows.map(({ date, revision }) => [date, revision]));
}

// Rebuild a kiosk that has no local data. Remote data is only ever used here,
// on first run. Once local data exists it is the authority.
async function recoverDeviceState(client: ConvexReactClient) {
  const deviceToken = DEVICE_TOKEN;
  const backup = await client.query(api.deviceBackups.get, { deviceToken, deviceId: DEVICE_ID });
  const deviceBoards = await collectPages((cursor) => client.query(api.deviceBoards.page, {
    deviceToken,
    deviceId: DEVICE_ID,
    paginationOpts: { cursor, numItems: RECOVERY_PAGE_SIZE },
  }));
  const serverRevisions: Record<string, number> = {};
  const boardsFromDevice = Object.fromEntries(deviceBoards.map(({ date, revision, strokes }) => {
    serverRevisions[date] = revision;
    return [date, strokes];
  }));
  // Boards recovered from deviceBoards start at the server's revision. The
  // device revision is then raised past every board revision so the first
  // edit to any recovered board is uploaded straight away.
  const withBoardRevisions = (state: DeviceState) => {
    const recoveredRevisions = Object.fromEntries(
      Object.entries(serverRevisions).filter(([, revision]) => isValidRevision(revision)),
    );
    const reconciled = reconcileBoardRevisions(
      { ...state, boardRevisions: { ...state.boardRevisions, ...recoveredRevisions } },
      serverRevisions,
    );
    return {
      backedUp: reconciled.backedUp,
      state: { ...state, revision: reconciled.revision, boardRevisions: reconciled.boardRevisions },
    };
  };

  if (backup) {
    // Older backups keep boards inline. Newer per-date documents win.
    const legacy = backup.state as Partial<LocalState>;
    return withBoardRevisions(toDeviceState({
      ...legacy,
      boards: { ...(legacy.boards ?? {}), ...boardsFromDevice },
      revision: backup.revision,
    }));
  }

  // No device backup at all: fall back to the original remote-first tables.
  const [legacyBoards, legacyChores, legacyCompletions] = await Promise.all([
    collectPages((cursor) => client.query(api.boards.list, {
      deviceToken,
      paginationOpts: { cursor, numItems: RECOVERY_PAGE_SIZE },
    })),
    client.query(api.chores.list, { deviceToken }) as Promise<ConvexChore[]>,
    collectPages((cursor) => client.query(api.chores.listCompletions, {
      deviceToken,
      paginationOpts: { cursor, numItems: 500 },
    })),
  ]);
  return withBoardRevisions(toDeviceState({
    revision: 0,
    boards: {
      ...Object.fromEntries(legacyBoards.map(({ date, strokes }) => [date, strokes])),
      ...boardsFromDevice,
    },
    chores: legacyChores.length > 0
      ? legacyChores.map(({ _id, ...chore }) => ({ ...chore, id: _id, category: chore.category ?? "standard" }))
      : undefined,
    completions: legacyCompletions,
  }));
}

function useDeviceBackup(
  state: DeviceState | null,
  setState: Dispatch<SetStateAction<DeviceState | null>>,
) {
  const client = useConvex();
  const saveBackup = useMutation(api.deviceBackups.save);
  const saveBoard = useMutation(api.deviceBoards.save);
  const [status, setStatus] = useState<BackupStatus>({ state: "pending" });
  const [retryTick, setRetryTick] = useState(0);
  const latestState = useRef(state);
  // Which board revisions the server is known to hold. Rebuilt from the
  // server on every start, so a lost or restored table is noticed rather than
  // trusted from local bookkeeping.
  const backedUpBoards = useRef<Record<string, number> | null>(null);
  const lastSavedContent = useRef<string | null>(null);
  const running = useRef(false);
  const rerunRequested = useRef(false);
  const failures = useRef(0);
  const retryTimer = useRef<number | undefined>(undefined);

  latestState.current = state;

  const fail = useCallback((message: string) => {
    failures.current += 1;
    setStatus((current) => current.state === "error" && current.message === message
      ? current
      : { state: "error", message, since: current.state === "error" ? current.since : Date.now() });
    window.clearTimeout(retryTimer.current);
    retryTimer.current = window.setTimeout(
      () => setRetryTick((tick) => tick + 1),
      backupRetryDelayMs(failures.current),
    );
  }, []);

  // First run with no local data: recover before the app becomes usable, and
  // keep retrying rather than starting empty and overwriting the backup.
  useEffect(() => {
    if (state) return;
    let cancelled = false;
    void recoverDeviceState(client).then((recovered) => {
      if (cancelled) return;
      // Persist before exposing the app, so a refresh during the first render
      // cannot send us back to a remote-first state.
      writeDeviceState(recovered.state);
      backedUpBoards.current = recovered.backedUp;
      setState(recovered.state);
    }).catch((error: unknown) => {
      if (!cancelled) fail(`Could not load the backup: ${errorMessage(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [client, fail, retryTick, setState, state]);

  const flush = useCallback(async (): Promise<void> => {
    if (running.current) {
      rerunRequested.current = true;
      return;
    }
    running.current = true;
    rerunRequested.current = false;
    const oversized = new Set<string>();
    try {
      if (!latestState.current) return;

      if (!backedUpBoards.current) {
        const server = await loadServerBoardRevisions(client);
        const current = latestState.current;
        if (!current) return;
        const reconciled = reconcileBoardRevisions(current, server);
        backedUpBoards.current = reconciled.backedUp;
        if (
          reconciled.revision !== current.revision
          || JSON.stringify(reconciled.boardRevisions) !== JSON.stringify(current.boardRevisions)
        ) {
          // Boards the server holds at a newer revision are moved past it.
          // The state change runs this again.
          setState((latest) => latest && {
            ...latest,
            revision: Math.max(latest.revision, reconciled.revision),
            boardRevisions: { ...latest.boardRevisions, ...reconciled.boardRevisions },
            updatedAt: Date.now(),
          });
          return;
        }
      }

      for (;;) {
        const current = latestState.current;
        if (!current) return;

        const payload = toBackupState(current);
        const content = backupContentKey(payload);
        if (content !== lastSavedContent.current) {
          if (jsonLength(payload) > MAX_BACKUP_JSON_LENGTH) {
            throw new Error("The device backup is too large. Old chores or tablet history need trimming.");
          }
          const result = await saveBackup({
            deviceToken: DEVICE_TOKEN,
            deviceId: DEVICE_ID,
            revision: current.revision,
            state: payload,
          });
          if (!result.accepted) {
            // The server has an equal or newer revision, usually because an
            // earlier upload got further than local bookkeeping. Local data is
            // the authority, so move past it and save again.
            setState((latest) => latest && latest.revision <= result.revision
              ? { ...latest, revision: result.revision + 1, updatedAt: Date.now() }
              : latest);
            rerunRequested.current = true;
            return;
          }
          lastSavedContent.current = content;
          continue;
        }

        const [date] = boardsNeedingBackup(current, backedUpBoards.current, oversized);
        if (!date) break;
        const strokes = toBackupStrokes(current.boards[date] ?? []);
        if (jsonLength(strokes) > MAX_BACKUP_JSON_LENGTH) {
          oversized.add(date);
          continue;
        }
        const revision = boardRevision(current, date);
        const result = await saveBoard({ deviceToken: DEVICE_TOKEN, deviceId: DEVICE_ID, date, revision, strokes });
        if (result.accepted || result.revision === revision) {
          backedUpBoards.current = { ...backedUpBoards.current, [date]: revision };
          continue;
        }
        // The server holds a newer revision of this board (a rolled-back
        // kiosk, or another client using this device ID). The screen is the
        // authority, so move this board past it and upload again.
        const next = Math.max(result.revision, current.revision) + 1;
        setState((latest) => latest && {
          ...latest,
          revision: Math.max(latest.revision, next),
          boardRevisions: { ...latest.boardRevisions, [date]: Math.max(next, boardRevision(latest, date)) },
          updatedAt: Date.now(),
        });
        rerunRequested.current = true;
        return;
      }

      if (oversized.size > 0) {
        fail(`Too large to back up: whiteboard ${[...oversized].join(", ")}. It is still saved on this screen.`);
        return;
      }
      failures.current = 0;
      window.clearTimeout(retryTimer.current);
      // Every change re-renders the whole app through this context, so only
      // refresh the timestamp occasionally.
      setStatus((current) => current.state === "ok" && Date.now() - current.lastBackedUpAt < 60_000
        ? current
        : { state: "ok", lastBackedUpAt: Date.now() });
    } catch (error) {
      console.error("Cannvas backup failed", error);
      fail(`Backup failed: ${errorMessage(error)}`);
    } finally {
      running.current = false;
      // Wait a tick so a state change made above has rendered first.
      if (rerunRequested.current && failures.current === 0) window.setTimeout(() => void flush(), 0);
    }
  }, [client, fail, saveBackup, saveBoard, setState]);

  useEffect(() => {
    if (!state) return;
    writeDeviceState(state);
    const timer = window.setTimeout(() => void flush(), BACKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [flush, retryTick, state]);

  useEffect(() => () => window.clearTimeout(retryTimer.current), []);

  return status;
}

function LocalFirstBackupProvider({ children }: PropsWithChildren) {
  // Once this key exists, it is the authority. Remote values are used only
  // for first-run recovery and are never reconciled over local actions.
  const [state, setState] = useState<DeviceState | null>(() => readStoredState(DEVICE_STORAGE_KEY));
  const backupStatus = useDeviceBackup(state, setState);
  const loadWorldNews = useAction(api.news.world);
  const loadPrimaryCalendar = useAction(api.calendar.events);
  const todosQuery = useQueryWithStatus(api.todos.list, { deviceToken: DEVICE_TOKEN });
  const lastTodos = useRef<Todo[] | undefined>(undefined);
  if (todosQuery.data) lastTodos.current = todosQuery.data;
  const canonicalTodos = todosQuery.data ?? lastTodos.current;
  const createCanonicalTodo = useMutation(api.todos.create);
  const updateCanonicalTodo = useMutation(api.todos.update);
  const toggleCanonicalTodo = useMutation(api.todos.toggle);
  const removeCanonicalTodo = useMutation(api.todos.remove);
  const importCanonicalTodos = useMutation(api.todos.importLegacy);
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(readCalendarCache);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>(() => (
    hasCurrentCalendarEvents(readCalendarCache()) ? "ready" : "loading"
  ));
  const legacyTodoImportStarted = useRef(false);

  useEffect(() => {
    if (todosQuery.isError) console.error("Could not load to-dos", todosQuery.error);
  }, [todosQuery.error, todosQuery.isError]);

  const loadCalendarRange = useCallback(async (requestedStart: string, requestedEnd: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const homeEnd = new Date(today);
    homeEnd.setDate(homeEnd.getDate() + 8);
    const requestedStartDate = new Date(requestedStart);
    const requestedEndDate = new Date(requestedEnd);
    const start = new Date(Math.min(today.getTime(), requestedStartDate.getTime()));
    const end = new Date(Math.max(homeEnd.getTime(), requestedEndDate.getTime()));

    try {
      const result = await withTimeout(
        loadPrimaryCalendar({
          deviceToken: DEVICE_TOKEN,
          start: start.toISOString(),
          end: end.toISOString(),
        }),
        CALENDAR_REQUEST_TIMEOUT_MS,
      );
      if (!result.configured) {
        setCalendarStatus("not-configured");
        return;
      }
      setCalendarEvents(result.events);
      setCalendarStatus("ready");
      window.localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(result.events));
    } catch {
      setCalendarStatus((current) => current === "ready" || current === "not-configured" ? current : "error");
    }
  }, [loadPrimaryCalendar]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadWorldNews({ deviceToken: DEVICE_TOKEN }).then((headlines) => {
        if (active && headlines.length > 0) setNewsHeadlines(headlines);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadWorldNews]);

  useEffect(() => {
    if (!state || canonicalTodos === undefined || legacyTodoImportStarted.current) return;
    legacyTodoImportStarted.current = true;
    void importCanonicalTodos({ deviceToken: DEVICE_TOKEN, todos: state.todos }).catch(() => {
      // A transient deployment or network failure should be retried on the
      // next render. The mutation itself is idempotent by legacy to-do ID.
      legacyTodoImportStarted.current = false;
    });
  }, [canonicalTodos, importCanonicalTodos, state]);

  useEffect(() => {
    const refresh = () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 8);
      void loadCalendarRange(start.toISOString(), end.toISOString());
    };
    refresh();
    // Retry quickly while startup is unhealthy. Once data arrives, return to
    // the normal 15-minute refresh so the calendar feed is not hammered.
    const timer = window.setInterval(
      refresh,
      calendarStatus === "ready" ? CALENDAR_REFRESH_MS : CALENDAR_RETRY_MS,
    );
    return () => window.clearInterval(timer);
  }, [calendarStatus, loadCalendarRange]);

  useEffect(() => {
    if (hasCurrentCalendarEvents(calendarEvents) || calendarStatus === "ready" || calendarStatus === "not-configured") return;

    // Chromium occasionally starts with a dead Convex request and leaves the
    // screensaver calendar blank forever. One guarded reload recreates the
    // connection. The cooldown prevents a reload loop during a real outage.
    const timer = window.setTimeout(() => {
      const lastReload = Number(window.sessionStorage.getItem(CALENDAR_RELOAD_KEY) ?? "0");
      if (Date.now() - lastReload < CALENDAR_RELOAD_COOLDOWN_MS) return;
      window.sessionStorage.setItem(CALENDAR_RELOAD_KEY, String(Date.now()));
      window.location.reload();
    }, calendarStatus === "error" ? 5_000 : CALENDAR_REQUEST_TIMEOUT_MS + 5_000);

    return () => window.clearTimeout(timer);
  }, [calendarEvents.length, calendarStatus]);

  const todoData = useMemo<TodoData>(() => ({
    todos: canonicalTodos?.map((todo) => ({ ...todo, id: todo.id })) ?? [],
    addTodo: async (title, assignee, priority, dueDate) => {
      await createCanonicalTodo({
        deviceToken: DEVICE_TOKEN,
        title,
        assignee,
        priority,
        dueDate,
      });
    },
    updateTodo: async (id, title, assignee, priority, dueDate) => {
      await updateCanonicalTodo({
        deviceToken: DEVICE_TOKEN,
        id: id as Id<"todos">,
        title,
        assignee,
        priority,
        dueDate,
      });
    },
    toggleTodo: async (id) => {
      await toggleCanonicalTodo({ deviceToken: DEVICE_TOKEN, id: id as Id<"todos"> });
    },
    removeTodo: async (id) => {
      await removeCanonicalTodo({ deviceToken: DEVICE_TOKEN, id: id as Id<"todos"> });
    },
    // An auth or network error should not hold the whole kiosk on the
    // loading screen. The list stays empty (or last known) instead.
    isReady: canonicalTodos !== undefined || todosQuery.isError,
  }), [
    canonicalTodos,
    createCanonicalTodo,
    removeCanonicalTodo,
    todosQuery.isError,
    toggleCanonicalTodo,
    updateCanonicalTodo,
  ]);
  const data = useDeviceData(
    state,
    setState,
    newsHeadlines,
    calendarEvents,
    calendarStatus,
    loadCalendarRange,
    "backup",
    backupStatus,
    todoData,
  );
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function DataProvider({ children }: PropsWithChildren) {
  const url = import.meta.env.VITE_CONVEX_URL;
  const client = useMemo(() => (url && DEVICE_TOKEN ? new ConvexReactClient(url) : null), [url]);

  if (!client) {
    if (url) console.warn("VITE_CANNVAS_DEVICE_TOKEN is not set, so Cannvas is running without a Convex backup.");
    return <LocalDataProvider>{children}</LocalDataProvider>;
  }
  return (
    <ConvexProvider client={client}>
      <LocalFirstBackupProvider>{children}</LocalFirstBackupProvider>
    </ConvexProvider>
  );
}

export function useCannvasData(): CannvasData {
  const value = useContext(DataContext);
  if (!value) throw new Error("useCannvasData must be used inside DataProvider");
  return value;
}
