import { CalendarDays, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useCannvasData } from "../data/DataProvider";
import type { Todo, TodoAssignee, TodoPriority } from "../data/types";

const KEYBOARD_CONTROL_URL = "http://127.0.0.1:4174";
const PEOPLE: Array<{ id: TodoAssignee; name: string; avatar: string }> = [
  { id: "mum", name: "Mum", avatar: "/avatars/mum.png" },
  { id: "josh", name: "Josh", avatar: "/avatars/josh.png" },
  { id: "dad", name: "Dad", avatar: "/avatars/dad.png" },
];
const PRIORITIES: TodoPriority[] = ["low", "medium", "high"];
const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

function setNativeKeyboardVisible(visible: boolean) {
  void fetch(`${KEYBOARD_CONTROL_URL}/${visible ? "show" : "hide"}`, {
    mode: "no-cors",
    cache: "no-store",
  }).catch(() => undefined);
}

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
  const { todos, addTodo, updateTodo, toggleTodo, removeTodo } = useCannvasData();
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<TodoAssignee>("josh");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [dueDate, setDueDate] = useState("");
  const openCount = todos.filter((todo) => !todo.completed).length;
  const completedCount = todos.length - openCount;

  const groupedTodos = useMemo(() => Object.fromEntries(
    PEOPLE.map(({ id }) => [id, todos.filter((todo) => todo.assignee === id).sort(sortTodos)]),
  ) as Record<TodoAssignee, Todo[]>, [todos]);

  useEffect(() => {
    setNativeKeyboardVisible(editingId !== null);
    return () => {
      if (editingId !== null) setNativeKeyboardVisible(false);
    };
  }, [editingId]);

  const openAdd = () => {
    setTitle("");
    setAssignee("josh");
    setPriority("medium");
    setDueDate("");
    setEditingId("new");
  };

  const openEdit = (todo: Todo) => {
    setTitle(todo.title);
    setAssignee(todo.assignee);
    setPriority(todo.priority);
    setDueDate(todo.dueDate ?? "");
    setEditingId(todo.id);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !editingId) return;
    if (editingId === "new") await addTodo(title.trim(), assignee, priority, dueDate || undefined);
    else await updateTodo(editingId, title.trim(), assignee, priority, dueDate || undefined);
    setEditingId(null);
  };

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

      <div className="todo-board">
        {PEOPLE.map((person) => {
          const personTodos = groupedTodos[person.id];
          return (
            <section className={`todo-person-column person-${person.id}`} key={person.id}>
              <header className="todo-person-header">
                <img src={person.avatar} alt={person.name} />
                <div><h2>{person.name}</h2><span>{personTodos.filter((todo) => !todo.completed).length} to do</span></div>
              </header>
              <div className="todo-list">
                {personTodos.map((todo) => (
                  <article className={todo.completed ? "todo-card completed" : "todo-card"} key={todo.id}>
                    <button className="todo-check" onClick={() => void toggleTodo(todo.id)} aria-label={`${todo.completed ? "Reopen" : "Finish"} ${todo.title}`} aria-pressed={todo.completed}>
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
                      <button onClick={() => setRemoveId(todo.id)} aria-label={`Remove ${todo.title}`}><Trash2 /></button>
                    </div>
                  </article>
                ))}
                {personTodos.length === 0 && <div className="todo-empty"><Check /><span>All clear</span></div>}
              </div>
            </section>
          );
        })}
      </div>

      <footer className="todos-actions">
        <button className="button primary" onClick={openAdd}><Plus /> Add a to-do</button>
      </footer>

      {editingId && (
        <div className="dialog-backdrop todo-dialog-backdrop" role="presentation" onPointerDown={() => setEditingId(null)}>
          <form className="dialog-card todo-editor-card" onSubmit={(event) => void submit(event)} onPointerDown={(event) => event.stopPropagation()}>
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

            <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setEditingId(null)}>Cancel</button><button className="button primary" type="submit" disabled={!title.trim()}>{editingId === "new" ? "Add to-do" : "Save changes"}</button></div>
          </form>
        </div>
      )}

      <ConfirmDialog open={removeId !== null} title="Remove this to-do?" confirmLabel="Remove to-do" onCancel={() => setRemoveId(null)} onConfirm={() => { if (removeId) void removeTodo(removeId); setRemoveId(null); }}>
        This removes it from the family list.
      </ConfirmDialog>
    </section>
  );
}
