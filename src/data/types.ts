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

// "local" means there is no Convex backup configured at all.
export type BackupStatus =
  | { state: "local" }
  | { state: "pending" }
  | { state: "ok"; lastBackedUpAt: number }
  | { state: "error"; message: string; since: number };

// The data is split into slices, each with its own React context, so a
// whiteboard stroke doesn't re-render the calendar and a news refresh
// doesn't re-render the whiteboard.

export type BoardsData = {
  boardDates: string[];
  getBoard: (date: string) => Stroke[];
  saveBoard: (date: string, strokes: Stroke[]) => Promise<void>;
};

export type ChoresData = {
  chores: Chore[];
  completions: Completion[];
  addChore: (name: string, valueCents: number, category: ChoreCategory) => Promise<void>;
  updateChore: (id: string, name: string, valueCents: number, category: ChoreCategory) => Promise<void>;
  removeChore: (id: string) => Promise<void>;
  toggleCompletion: (choreId: string, date: string) => Promise<void>;
  clearWeek: (weekStart: string) => Promise<void>;
};

export type TabletsData = {
  tabletSchedules: TabletSchedule[];
  tabletCompletions: TabletCompletion[];
  setTabletDueDate: (tabletId: TabletId, dueDate?: string) => Promise<void>;
  completeTablet: (tabletId: TabletId, takenDate: string) => Promise<void>;
  undoTabletCompletion: (tabletId: TabletId) => Promise<void>;
};

// To-dos live in Convex, so unlike the rest they can still be loading.
export type TodosStatus = "loading" | "ready" | "error";

export type TodosData = {
  todos: Todo[];
  todosStatus: TodosStatus;
  addTodo: (title: string, assignee: TodoAssignee, priority: TodoPriority, dueDate?: string) => Promise<void>;
  updateTodo: (id: string, title: string, assignee: TodoAssignee, priority: TodoPriority, dueDate?: string) => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  removeTodo: (id: string) => Promise<void>;
};

// The month shown in the Calendar app. Kept apart from the home screen's
// next-week events so a background refresh can't replace it.
export type CalendarMonth = {
  start: string;
  end: string;
  events: CalendarEvent[];
  status: CalendarStatus;
};

export type CalendarData = {
  /** Today and the next week, for the home screen. */
  calendarEvents: CalendarEvent[];
  calendarStatus: CalendarStatus;
  calendarMonth: CalendarMonth | null;
  loadCalendarRange: (start: string, end: string) => Promise<void>;
};

export type NewsData = {
  newsHeadlines: NewsHeadline[];
};

export type DeviceStatus = {
  /** False only on a brand new screen while its backup is being restored. */
  isReady: boolean;
  backupStatus: BackupStatus;
  mode: "backup" | "local";
};

export type CannvasData = BoardsData & ChoresData & TabletsData & TodosData & CalendarData & NewsData & DeviceStatus;
