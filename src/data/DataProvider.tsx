import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ConvexProvider, ConvexReactClient, useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { CannvasData, Chore, Completion, NewsHeadline, Stroke } from "./types";

const DataContext = createContext<CannvasData | null>(null);
const STORAGE_KEY = "cannvas-local-data-v1";
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
};

const initialState: LocalState = {
  boards: {},
  chores: [
    { id: "make-bed", name: "Make my bed", valueCents: 50, color: COLORS[0], position: 0 },
    { id: "feed-pets", name: "Feed the pets", valueCents: 50, color: COLORS[2], position: 1 },
    { id: "tidy-room", name: "Tidy my room", valueCents: 100, color: COLORS[3], position: 2 },
  ],
  completions: [],
};

function readLocalState(): LocalState {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as LocalState) : initialState;
  } catch {
    return initialState;
  }
}

function LocalDataProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<LocalState>(readLocalState);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const data = useMemo<CannvasData>(() => ({
    boardDates: Object.entries(state.boards)
      .filter(([, strokes]) => strokes.length > 0)
      .map(([date]) => date),
    getBoard: (date) => state.boards[date] ?? [],
    saveBoard: async (date, strokes) => {
      setState((current) => ({ ...current, boards: { ...current.boards, [date]: strokes } }));
    },
    chores: state.chores,
    completions: state.completions,
    newsHeadlines: PREVIEW_HEADLINES,
    addChore: async (name, valueCents) => {
      setState((current) => ({
        ...current,
        chores: [...current.chores, {
          id: crypto.randomUUID(),
          name,
          valueCents,
          color: COLORS[current.chores.length % COLORS.length],
          position: current.chores.length,
        }],
      }));
    },
    renameChore: async (id, name) => {
      setState((current) => ({
        ...current,
        chores: current.chores.map((chore) => chore.id === id ? { ...chore, name } : chore),
      }));
    },
    removeChore: async (id) => {
      setState((current) => ({
        ...current,
        chores: current.chores.filter((chore) => chore.id !== id),
        completions: current.completions.filter((completion) => completion.choreId !== id),
      }));
    },
    toggleCompletion: async (choreId, date) => {
      setState((current) => {
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
      setState((current) => ({
        ...current,
        completions: current.completions.filter(({ date }) => {
          const value = new Date(`${date}T00:00:00`);
          return value < start || value >= end;
        }),
      }));
    },
    isReady: true,
    mode: "local",
  }), [state]);

  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

type ConvexBoard = { date: string; strokes: Stroke[] };
type ConvexChore = Chore & { _id: Id<"chores"> };

function ConvexDataProvider({ children }: PropsWithChildren) {
  const boards = useQuery(api.boards.list) as ConvexBoard[] | undefined;
  const chores = useQuery(api.chores.list) as ConvexChore[] | undefined;
  const completions = useQuery(api.chores.listCompletions) as Completion[] | undefined;
  const seed = useMutation(api.chores.seed);
  const saveBoardMutation = useMutation(api.boards.save);
  const addChoreMutation = useMutation(api.chores.add);
  const removeChoreMutation = useMutation(api.chores.remove);
  const renameChoreMutation = useMutation(api.chores.rename);
  const toggleMutation = useMutation(api.chores.toggleCompletion);
  const clearMutation = useMutation(api.chores.clearWeek);
  const loadWorldNews = useAction(api.news.world);
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([]);

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
    if (chores?.length === 0) void seed();
  }, [chores, seed]);

  const data = useMemo<CannvasData>(() => ({
    boardDates: (boards ?? []).filter((board) => board.strokes.length > 0).map((board) => board.date),
    getBoard: (date) => boards?.find((board) => board.date === date)?.strokes ?? [],
    saveBoard: async (date, strokes) => { await saveBoardMutation({ date, strokes }); },
    chores: (chores ?? []).map(({ _id, ...chore }) => ({ ...chore, id: _id })),
    completions: completions ?? [],
    newsHeadlines,
    addChore: async (name, valueCents) => { await addChoreMutation({ name, valueCents }); },
    renameChore: async (id, name) => { await renameChoreMutation({ id: id as Id<"chores">, name }); },
    removeChore: async (id) => { await removeChoreMutation({ id: id as Id<"chores"> }); },
    toggleCompletion: async (choreId, date) => { await toggleMutation({ choreId: choreId as Id<"chores">, date }); },
    clearWeek: async (weekStart) => { await clearMutation({ weekStart }); },
    isReady: boards !== undefined && chores !== undefined && completions !== undefined,
    mode: "convex",
  }), [
    addChoreMutation,
    boards,
    chores,
    clearMutation,
    completions,
    newsHeadlines,
    renameChoreMutation,
    removeChoreMutation,
    saveBoardMutation,
    toggleMutation,
  ]);

  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

export function DataProvider({ children }: PropsWithChildren) {
  const url = import.meta.env.VITE_CONVEX_URL;
  const client = useMemo(() => (url ? new ConvexReactClient(url) : null), [url]);

  if (!client) return <LocalDataProvider>{children}</LocalDataProvider>;
  return (
    <ConvexProvider client={client}>
      <ConvexDataProvider>{children}</ConvexDataProvider>
    </ConvexProvider>
  );
}

export function useCannvasData(): CannvasData {
  const value = useContext(DataContext);
  if (!value) throw new Error("useCannvasData must be used inside DataProvider");
  return value;
}
