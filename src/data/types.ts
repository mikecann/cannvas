export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  kind?: "stroke" | "sticker";
  color: string;
  width: number;
  points: Point[];
  sticker?: string;
};

export type ChoreCategory = "standard" | "bonus";

export type Chore = {
  id: string;
  name: string;
  valueCents: number;
  category: ChoreCategory;
  color: string;
  position: number;
};

export type Completion = {
  choreId: string;
  date: string;
};

export type NewsHeadline = {
  title: string;
  url: string;
};

export type CannvasData = {
  boardDates: string[];
  getBoard: (date: string) => Stroke[];
  saveBoard: (date: string, strokes: Stroke[]) => Promise<void>;
  chores: Chore[];
  completions: Completion[];
  newsHeadlines: NewsHeadline[];
  addChore: (name: string, valueCents: number, category: ChoreCategory) => Promise<void>;
  updateChore: (id: string, name: string, valueCents: number, category: ChoreCategory) => Promise<void>;
  removeChore: (id: string) => Promise<void>;
  toggleCompletion: (choreId: string, date: string) => Promise<void>;
  clearWeek: (weekStart: string) => Promise<void>;
  isReady: boolean;
  mode: "backup" | "local";
};
