import { CalendarDays, Check, CloudOff, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DialogBackdrop } from "../components/DialogBackdrop";
import { useTodos } from "../data/DataProvider";
import type { Todo, TodoAssignee, TodoPriority } from "../data/types";
import { errorText } from "../lib/http";

const PEOPLE: Array<{ id: TodoAssignee; name: string; avatar: string }> = [
  { id: "mum", name: "Mum", avatar: "/avatars/mum.png" },
  { id: "josh", name: "Josh", avatar: "/avatars/josh.png" },
  { id: "dad", name: "Dad", avatar: "/avatars/dad.png" },
];
const PRIORITIES: TodoPriority[] = ["low", "medium", "high"];
const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

function friendlyDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  return value.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function sortTodos(left: Todo, right: Todo) {
  if (left.completed !== right.completed) return Number(left.completed) - Number(right.completed);
  if (PRIORITY_ORDER[left.priority] !== PRIORITY_ORDER[right.priority]) {
    return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
  }
  if (left.dueDate && right.dueDate) return left.dueDate.localeCompare(right.dueDate);
  if (left.dueDate) return -1;
  if (right.dueDate) return 1;
  return left.createdAt - right.createdAt;
}

export function TodosApp() {
  const { todos, todosStatus, addTodo, updateTodo, toggleTodo, removeTodo } = useTodos();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<TodoAssignee>("josh");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [listError, setListError] = useState("");
  const [confirmClearFinished, setConfirmClearFinished] = useState(false);
  const [clearing, setClearing] = useState(false);
  const openCount = todos.filter((todo) => !todo.completed).length;
  const completedCount = todos.length - openCount;
  const editingTodo = todos.find((todo) => todo.id === editingId);
  // A stray touch on the backdrop may only close a form with nothing to lose.
  const editorUnchanged = editingId === "new"
    ? !title.trim()
    : editingTodo !== undefined
      && title === editingTodo.title
      && assignee === editingTodo.assignee
      && priority === editingTodo.priority
      && dueDate === (editingTodo.dueDate ?? "");

  const groupedTodos = useMemo(() => Object.fromEntries(
    PEOPLE.map(({ id }) => [id, todos.filter((todo) => todo.assignee === id).sort(sortTodos)]),
  ) as Record<TodoAssignee, Todo[]>, [todos]);

  const openAdd = (selectedAssignee: TodoAssignee = "josh") => {
    setTitle("");
    setAssignee(selectedAssignee);
    setPriority("medium");
    setDueDate("");
    setEditorError("");
    setEditingId("new");
  };

  const openEdit = (todo: Todo) => {
    setTitle(todo.title);
    setAssignee(todo.assignee);
    setPriority(todo.priority);
    setDueDate(todo.dueDate ?? "");
    setEditorError("");
    setEditingId(todo.id);
  };

  const closeEditor = () => {
    if (!saving) setEditingId(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !editingId || saving) return;
    setSaving(true);
    setEditorError("");
    try {
      if (editingId === "new") await addTodo(title.trim(), assignee, priority, dueDate || undefined);
      else await updateTodo(editingId, title.trim(), assignee, priority, dueDate || undefined);
      setEditingId(null);
    } catch (error) {
      setEditorError(`Couldn't save that to-do. ${errorText(error, "Check the connection and try again.")}`);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (todo: Todo) => {
    setListError("");
    try {
      await toggleTodo(todo.id);
    } catch (error) {
      setListError(`Couldn't update "${todo.title}". ${errorText(error, "Try again in a moment.")}`);
    }
  };

  const clearFinished = async () => {
    setClearing(true);
    setListError("");
    const finished = todos.filter((todo) => todo.completed);
    const results = await Promise.allSettled(finished.map((todo) => removeTodo(todo.id)));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) setListError(`Couldn't clear ${failed} finished to-do${failed === 1 ? "" : "s"}. Try again in a moment.`);
    setClearing(false);
    setConfirmClearFinished(false);
  };

  if (todosStatus !== "ready") {
    const loading = todosStatus === "loading";
    return (
      <section className="todos-app todos-app-waiting">
        <div className="todos-waiting" role="status">
          {loading ? <LoaderCircle className="spin" /> : <CloudOff />}
          <strong>{loading ? "Fetching the family list…" : "Can't reach the to-do list right now"}</strong>
          <span>{loading
            ? "This only takes a moment."
            : "It lives online, so it'll be back when the connection is. Everything else on the screen still works."}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="todos-app">
      <header className="todos-header">
        <div>
          <p className="eyebrow">Our family list</p>
          <h1>To-do's</h1>
          <p className="header-note">See what matters, and who is on it.</p>
        </div>
        <div className="todo-summary-card">
          <span><strong>{openCount}</strong> still to do</span>
          <span><strong>{completedCount}</strong> finished</span>
        </div>
      </header>

      {listError && <p className="todos-error" role="alert">{listError}</p>}

      <div className="todo-board">
        {PEOPLE.map((person) => {
          const personTodos = groupedTodos[person.id];
          return (
            <section className={`todo-person-column person-${person.id}`} key={person.id}>
              <header className="todo-person-header">
                <img src={person.avatar} alt={person.name} />
                <div className="todo-person-copy"><h2>{person.name}</h2><span>{personTodos.filter((todo) => !todo.completed).length} to do</span></div>
                <button className="todo-person-add" onClick={() => openAdd(person.id)} aria-label={`Add a to-do for ${person.name}`}><Plus /></button>
              </header>
              <div className="todo-list">
                {personTodos.map((todo) => (
                  <article className={todo.completed ? "todo-card completed" : "todo-card"} key={todo.id}>
                    <button className="todo-check" onClick={() => void toggle(todo)} aria-label={`${todo.completed ? "Reopen" : "Finish"} ${todo.title}`} aria-pressed={todo.completed}>
                      {todo.completed && <Check strokeWidth={4} />}
                    </button>
                    <div className="todo-copy">
                      <strong>{todo.title}</strong>
                      <div className="todo-meta">
                        <span className={`priority-badge ${todo.priority}`}>{todo.priority}</span>
                        {todo.dueDate && <span className="due-date"><CalendarDays /> {friendlyDate(todo.dueDate)}</span>}
                      </div>
                    </div>
                    <div className="todo-card-actions">
                      <button onClick={() => openEdit(todo)} aria-label={`Edit ${todo.title}`}><Pencil /></button>
                    </div>
                  </article>
                ))}
                {personTodos.length === 0 && <div className="todo-empty"><Check /><span>All clear</span></div>}
              </div>
            </section>
          );
        })}
        <footer className="todos-actions app-control-palette">
          <button className="button primary" onClick={() => openAdd()}><Plus /> Add a to-do</button>
          {completedCount > 0 && (
            <button className="button secondary" onClick={() => setConfirmClearFinished(true)}><Trash2 /> Clear finished</button>
          )}
        </footer>
      </div>

      {editingId && (
        <DialogBackdrop className="todo-dialog-backdrop" onDismiss={editorUnchanged && !saving ? closeEditor : undefined}>
          <form className="dialog-card todo-editor-card" onSubmit={(event) => void submit(event)}>
            <div className={`dialog-symbol ${editingId === "new" ? "add" : "edit"}`}>{editingId === "new" ? <Plus /> : <Pencil />}</div>
            <h2>{editingId === "new" ? "Add a to-do" : "Edit to-do"}</h2>
            <label className="todo-title-field"><span>What needs doing?</span><input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" placeholder="Type a to-do" /></label>

            <fieldset className="todo-option-picker assignee-picker">
              <legend>Who is doing it?</legend>
              <div>{PEOPLE.map((person) => <button type="button" className={assignee === person.id ? "selected" : ""} key={person.id} onClick={() => setAssignee(person.id)}><img src={person.avatar} alt="" /><span>{person.name}</span></button>)}</div>
            </fieldset>

            <div className="todo-editor-options">
              <fieldset className="todo-option-picker priority-picker">
                <legend>Priority</legend>
                <div>{PRIORITIES.map((value) => <button type="button" className={`${value} ${priority === value ? "selected" : ""}`} key={value} onClick={() => setPriority(value)}>{value}</button>)}</div>
              </fieldset>
              <label className="todo-due-field"><span>Due date <small>optional</small></span><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
            </div>

            {editorError && <p className="dialog-error" role="alert">{editorError}</p>}
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={closeEditor} disabled={saving}>Cancel</button>
              <button className="button primary" type="submit" disabled={!title.trim() || saving}>
                {saving ? "Saving…" : editingId === "new" ? "Add to-do" : "Save changes"}
              </button>
            </div>
          </form>
        </DialogBackdrop>
      )}

      <ConfirmDialog
        open={confirmClearFinished}
        title="Clear finished to-dos?"
        confirmLabel={clearing ? "Clearing…" : `Clear ${completedCount}`}
        confirmDisabled={clearing}
        onCancel={() => { if (!clearing) setConfirmClearFinished(false); }}
        onConfirm={() => void clearFinished()}
      >
        This removes the {completedCount} ticked-off to-do{completedCount === 1 ? "" : "s"} from everyone's list.
      </ConfirmDialog>
    </section>
  );
}
