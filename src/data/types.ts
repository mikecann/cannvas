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

export type TabletId = "nuheart" | "milbemax" | "bravecto";

export type TabletSchedule = {
  id: TabletId;
  name: string;
  purpose: string;
  cadenceMonths: 1 | 3;
  color: string;
  dueDate?: string;
};

export type TabletCompletion = {
  id: string;
  tabletId: TabletId;
  takenDate: string;
  previousDueDate?: string;
};

export type TodoAssignee = "mum" | "dad" | "josh";
export type TodoPriority = "low" | "medium" | "high";

export type Todo = {
  id: string;
  title: string;
  assignee: TodoAssignee;
  priority: TodoPriority;
  dueDate?: string;
  completed: boolean;
  createdAt: number;
};

export type NewsHeadline = {
  title: string;
  url: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
};

export type CalendarStatus = "loading" | "ready" | "not-configured" | "error";

export type CannvasData = {
  boardDates: string[];
  getBoard: (date: string) => Stroke[];
  saveBoard: (date: string, strokes: Stroke[]) => Promise<void>;
  chores: Chore[];
  completions: Completion[];
  tabletSchedules: TabletSchedule[];
  tabletCompletions: TabletCompletion[];
  todos: Todo[];
  newsHeadlines: NewsHeadline[];
  calendarEvents: CalendarEvent[];
  calendarStatus: CalendarStatus;
  loadCalendarRange: (start: string, end: string) => Promise<void>;
  addChore: (name: string, valueCents: number, category: ChoreCategory) => Promise<void>;
  updateChore: (id: string, name: string, valueCents: number, category: ChoreCategory) => Promise<void>;
  removeChore: (id: string) => Promise<void>;
  toggleCompletion: (choreId: string, date: string) => Promise<void>;
  clearWeek: (weekStart: string) => Promise<void>;
  setTabletDueDate: (tabletId: TabletId, dueDate?: string) => Promise<void>;
  completeTablet: (tabletId: TabletId, takenDate: string) => Promise<void>;
  undoTabletCompletion: (tabletId: TabletId) => Promise<void>;
  addTodo: (title: string, assignee: TodoAssignee, priority: TodoPriority, dueDate?: string) => Promise<void>;
  updateTodo: (id: string, title: string, assignee: TodoAssignee, priority: TodoPriority, dueDate?: string) => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  removeTodo: (id: string) => Promise<void>;
  isReady: boolean;
  mode: "backup" | "local";
};
