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
import type { CannvasData, Chore, ChoreCategory, Completion, NewsHeadline, Stroke, Todo } from "./types";

const DataContext = createContext<CannvasData | null>(null);
const DEVICE_STORAGE_KEY = "cannvas-device-data-v2";
const LEGACY_LOCAL_STORAGE_KEY = "cannvas-local-data-v1";
const DEVICE_ID = import.meta.env.VITE_CANNVAS_DEVICE_ID
  ?? (import.meta.env.PROD ? "mirror" : "development");
const BACKUP_DEBOUNCE_MS = 500;
const COLORS = ["#ff8066", "#ffbf47", "#5ec6a5", "#6ba7ff", "#a77bea", "#ff7eb3"];
const PREVIEW_HEADLINES: NewsHeadline[] = [
  { title: "World headlines will update automatically", url: "https://www.bbc.com/news/world" },
  { title: "The news source can be changed later", url: "https://www.bbc.com/news/world" },
  { title: "Fresh stories appear throughout the day", url: "https://www.bbc.com/news/world" },
];

type LocalState = {
  boards: Record<string, Stroke[]>;
  chores: Chore[];
  completions: Completion[];
  todos: Todo[];
};

type DeviceState = LocalState & {
  version: 2;
  revision: number;
  updatedAt: number;
};

type ConvexBoard = { date: string; strokes: Stroke[]; updatedAt?: number };
type ConvexChore = Omit<Chore, "category"> & { category?: ChoreCategory; _id: string };
type DeviceBackup = { revision: number; state: unknown; updatedAt: number } | null;

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
  };
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
  mode: CannvasData["mode"],
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
    todos: visibleState.todos,
    newsHeadlines,
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
    addTodo: async (title, assignee, priority, dueDate) => {
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
    },
    updateTodo: async (id, title, assignee, priority, dueDate) => {
      updateState((current) => ({
        ...current,
        todos: current.todos.map((todo) => todo.id === id
          ? { ...todo, title, assignee, priority, dueDate: dueDate || undefined }
          : todo),
      }));
    },
    toggleTodo: async (id) => {
      updateState((current) => ({
        ...current,
        todos: current.todos.map((todo) => todo.id === id ? { ...todo, completed: !todo.completed } : todo),
      }));
    },
    removeTodo: async (id) => {
      updateState((current) => ({
        ...current,
        todos: current.todos.filter((todo) => todo.id !== id),
      }));
    },
    isReady: state !== null,
    mode,
  }), [mode, newsHeadlines, state, updateState, visibleState]);
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

  const data = useDeviceData(state, setState, PREVIEW_HEADLINES, "local");
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
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([]);
  const backupBaselineChecked = useRef(false);

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

  const data = useDeviceData(state, setState, newsHeadlines, "backup");
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
