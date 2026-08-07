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
import { ConvexProvider, ConvexReactClient, useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CalendarEvent, CalendarStatus, CannvasData, Chore, ChoreCategory, Completion, NewsHeadline, Stroke, TabletCompletion, TabletSchedule, Todo } from "./types";

const DataContext = createContext<CannvasData | null>(null);
const DEVICE_STORAGE_KEY = "cannvas-device-data-v2";
const LEGACY_LOCAL_STORAGE_KEY = "cannvas-local-data-v1";
const DEVICE_ID = import.meta.env.VITE_CANNVAS_DEVICE_ID
  ?? (import.meta.env.PROD ? "mirror" : "development");
const TODO_ACCESS_TOKEN = import.meta.env.VITE_CANNVAS_TODO_ACCESS_TOKEN ?? "";
const BACKUP_DEBOUNCE_MS = 500;
const CALENDAR_CACHE_KEY = "cannvas-calendar-cache-v1";
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

type LocalState = {
  boards: Record<string, Stroke[]>;
  chores: Chore[];
  completions: Completion[];
  todos: Todo[];
  tabletSchedules: TabletSchedule[];
  tabletCompletions: CannvasData["tabletCompletions"];
};

type DeviceState = LocalState & {
  version: 2;
  revision: number;
  updatedAt: number;
};

type ConvexBoard = { date: string; strokes: Stroke[]; updatedAt?: number };
type ConvexChore = Omit<Chore, "category"> & { category?: ChoreCategory; _id: string };
type DeviceBackup = { revision: number; state: unknown; updatedAt: number } | null;
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
      { id: "nuheart", name: "Nuheart", purpose: "Heartworm", cadenceMonths: 1, color: "#ed6a5a" },
      { id: "milbemax", name: "Milbemax", purpose: "Intestinal worms", cadenceMonths: 3, color: "#5f8fda" },
      { id: "bravecto", name: "Bravecto", purpose: "Fleas and ticks", cadenceMonths: 3, color: "#8c6bc7" },
    ],
    tabletCompletions: INITIAL_TABLET_HISTORY,
  };
}

function toDeviceState(value: Partial<LocalState & Pick<DeviceState, "revision">>): DeviceState {
  const fallback = createInitialLocalState();
  return {
    version: 2,
    revision: Number.isFinite(value.revision) ? Math.max(0, Number(value.revision)) : 0,
    updatedAt: Date.now(),
    boards: value.boards ?? fallback.boards,
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
      // Keep product names and intervals current while preserving the dates
      // already entered on the mirror.
      return { ...defaultSchedule, dueDate: stored?.dueDate };
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
  todoData?: TodoData,
): CannvasData {
  const updateState = useCallback((update: (current: DeviceState) => LocalState) => {
    setState((current) => {
      if (!current) return current;
      const next = update(current);
      return {
        ...next,
        version: 2,
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
        boards: { ...current.boards, [date]: strokes },
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
            ? { ...candidate, dueDate: addMonthsToDateKey(takenDate, candidate.cadenceMonths) }
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
    mode,
  }), [calendarEvents, calendarStatus, loadCalendarRange, mode, newsHeadlines, state, todoData, updateState, visibleState]);
}

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
  const data = useDeviceData(state, setState, PREVIEW_HEADLINES, calendarEvents, "ready", loadCalendarRange, "local");
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

function LocalFirstBackupProvider({ children }: PropsWithChildren) {
  // Once this key exists, it is the authority. Remote values below are used
  // only for first-run recovery and are never reconciled over local actions.
  const [state, setState] = useState<DeviceState | null>(() => readStoredState(DEVICE_STORAGE_KEY));
  const backup = useQuery(api.deviceBackups.get, { deviceId: DEVICE_ID }) as DeviceBackup | undefined;
  const legacyBoards = useQuery(api.boards.list) as ConvexBoard[] | undefined;
  const legacyChores = useQuery(api.chores.list) as ConvexChore[] | undefined;
  const legacyCompletions = useQuery(api.chores.listCompletions) as Completion[] | undefined;
  const saveBackup = useMutation(api.deviceBackups.save);
  const loadWorldNews = useAction(api.news.world);
  const loadPrimaryCalendar = useAction(api.calendar.events);
  const canonicalTodos = useQuery(
    api.todos.list,
    TODO_ACCESS_TOKEN ? { accessToken: TODO_ACCESS_TOKEN } : "skip",
  );
  const createCanonicalTodo = useMutation(api.todos.create);
  const updateCanonicalTodo = useMutation(api.todos.update);
  const toggleCanonicalTodo = useMutation(api.todos.toggle);
  const removeCanonicalTodo = useMutation(api.todos.remove);
  const importCanonicalTodos = useMutation(api.todos.importLegacy);
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(readCalendarCache);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>(() => readCalendarCache().length > 0 ? "ready" : "loading");
  const backupBaselineChecked = useRef(false);
  const legacyTodoImportStarted = useRef(false);

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
      const result = await loadPrimaryCalendar({
        accessToken: import.meta.env.VITE_CALENDAR_ACCESS_TOKEN ?? "",
        start: start.toISOString(),
        end: end.toISOString(),
      });
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
    if (state || backup === undefined) return;

    if (backup) {
      const recovered = toDeviceState({ ...(backup.state as Partial<LocalState>), revision: backup.revision });
      writeDeviceState(recovered);
      setState(recovered);
      return;
    }

    if (legacyBoards === undefined || legacyChores === undefined || legacyCompletions === undefined) return;

    const recovered = toDeviceState({
      revision: 0,
      boards: Object.fromEntries(legacyBoards.map(({ date, strokes }) => [date, strokes])),
      chores: legacyChores.length > 0
        ? legacyChores.map(({ _id, ...chore }) => ({ ...chore, id: _id, category: chore.category ?? "standard" }))
        : undefined,
      completions: legacyCompletions,
    });

    // Persist recovery before exposing the app, so even a refresh during the
    // first render cannot send us back to a remote-first state.
    writeDeviceState(recovered);
    setState(recovered);
  }, [backup, legacyBoards, legacyChores, legacyCompletions, state]);

  useEffect(() => {
    if (backup === undefined || backupBaselineChecked.current) return;
    backupBaselineChecked.current = true;

    // Only the remote revision is considered. If a prior upload got further
    // than local bookkeeping, move the local revision forward without ever
    // importing the remote payload over device data.
    if (state && backup && backup.revision >= state.revision) {
      setState((current) => current && current.revision <= backup.revision
        ? { ...current, revision: backup.revision + 1, updatedAt: Date.now() }
        : current);
    }
  }, [backup, state]);

  useEffect(() => {
    if (!state || backup === undefined) return;
    writeDeviceState(state);
    const timer = window.setTimeout(() => {
      void saveBackup({
        deviceId: DEVICE_ID,
        revision: state.revision,
        state,
      }).catch(() => undefined);
    }, BACKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [saveBackup, state]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void loadWorldNews({}).then((headlines) => {
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
    if (!TODO_ACCESS_TOKEN || !state || canonicalTodos === undefined || legacyTodoImportStarted.current) return;
    legacyTodoImportStarted.current = true;
    void importCanonicalTodos({ accessToken: TODO_ACCESS_TOKEN, todos: state.todos }).catch(() => {
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
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadCalendarRange]);

  const todoData = useMemo<TodoData | undefined>(() => TODO_ACCESS_TOKEN ? ({
    todos: canonicalTodos?.map((todo) => ({ ...todo, id: todo.id })) ?? [],
    addTodo: async (title, assignee, priority, dueDate) => {
      await createCanonicalTodo({
        accessToken: TODO_ACCESS_TOKEN,
        title,
        assignee,
        priority,
        dueDate,
      });
    },
    updateTodo: async (id, title, assignee, priority, dueDate) => {
      await updateCanonicalTodo({
        accessToken: TODO_ACCESS_TOKEN,
        id: id as Id<"todos">,
        title,
        assignee,
        priority,
        dueDate,
      });
    },
    toggleTodo: async (id) => {
      await toggleCanonicalTodo({ accessToken: TODO_ACCESS_TOKEN, id: id as Id<"todos"> });
    },
    removeTodo: async (id) => {
      await removeCanonicalTodo({ accessToken: TODO_ACCESS_TOKEN, id: id as Id<"todos"> });
    },
    isReady: canonicalTodos !== undefined,
  }) : undefined, [
    canonicalTodos,
    createCanonicalTodo,
    removeCanonicalTodo,
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
    todoData,
  );
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function DataProvider({ children }: PropsWithChildren) {
  const url = import.meta.env.VITE_CONVEX_URL;
  const client = useMemo(() => (url ? new ConvexReactClient(url) : null), [url]);

  if (!client) return <LocalDataProvider>{children}</LocalDataProvider>;
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
