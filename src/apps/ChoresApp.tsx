import { Check, ChevronLeft, ChevronRight, CircleHelp, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ChoreCategoryPicker } from "../components/ChoreCategoryPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useCannvasData } from "../data/DataProvider";
import type { ChoreCategory } from "../data/types";
import { addDays, dateKey, fromDateKey, money, startOfWeek } from "../lib/dates";

export function ChoresApp() {
  const { chores, completions, addChore, updateChore, removeChore, toggleCompletion } = useCannvasData();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [showAdd, setShowAdd] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [choreToRemove, setChoreToRemove] = useState<string | null>(null);
  const [choreToEdit, setChoreToEdit] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("0.50");
  const [category, setCategory] = useState<ChoreCategory>("standard");
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const completionKeys = useMemo(
    () => new Set(completions.map(({ choreId, date }) => `${choreId}:${date}`)),
    [completions],
  );
  const weekDates = new Set(days.map(dateKey));
  const bonusChores = chores.filter((chore) => chore.category === "bonus");
  const standardChores = chores.filter((chore) => chore.category === "standard");
  const earned = completions.reduce((total, completion) => {
    if (!weekDates.has(completion.date)) return total;
    const chore = chores.find((candidate) => candidate.id === completion.choreId);
    return total + (chore?.category === "bonus" ? chore.valueCents : 0);
  }, 0);
  const possible = bonusChores.reduce((total, chore) => total + chore.valueCents * 7, 0);
  const standardDone = completions.filter((completion) => weekDates.has(completion.date) && standardChores.some((chore) => chore.id === completion.choreId)).length;
  const standardPossible = standardChores.length * 7;
  const isThisWeek = dateKey(weekStart) === dateKey(startOfWeek(new Date()));
  const submitChore = async (event: React.FormEvent) => {
    event.preventDefault();
    const valueCents = Math.round(Number(value) * 100);
    if (!name.trim() || !Number.isFinite(valueCents) || valueCents < 0) return;
    await addChore(name.trim(), valueCents, category);
    setName("");
    setValue("0.50");
    setShowAdd(false);
  };

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!choreToEdit || !name.trim()) return;
    const valueCents = Math.round(Number(value) * 100);
    if (!Number.isFinite(valueCents) || valueCents < 0) return;
    await updateChore(choreToEdit, name.trim(), valueCents, category);
    setChoreToEdit(null);
  };

  const openAdd = () => {
    setName("");
    setValue("0.50");
    setCategory("standard");
    setShowAdd(true);
  };

  const openEdit = (id: string) => {
    const chore = chores.find((candidate) => candidate.id === id);
    if (!chore) return;
    setName(chore.name);
    setValue((chore.valueCents / 100).toFixed(2));
    setCategory(chore.category);
    setChoreToEdit(id);
  };

  return (
    <section className="chores-app">
      <header className="chores-header">
        <div>
          <p className="eyebrow">Joshua's week</p>
          <h1>Chore Quest <Sparkles className="sparkle" /></h1>
          <p className="header-note">Small jobs, big wins.</p>
        </div>
        <div className="reward-card">
          <span>Bonus earned this week</span>
          <strong>{money(earned)}</strong>
          <div className="reward-progress"><span style={{ width: `${possible ? Math.min(100, (earned / possible) * 100) : 0}%` }} /></div>
          <small>{money(possible)} bonus available</small>
          <small className="standard-summary">Standard checks {standardDone}/{standardPossible}</small>
        </div>
      </header>

      <div className="week-toolbar">
        <button className="icon-button" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft /></button>
        <button className="week-label" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          <strong>{isThisWeek ? "This week" : `Week of ${weekStart.toLocaleDateString("en-AU", { day: "numeric", month: "long" })}`}</strong>
          {!isThisWeek && <span>Tap to return to this week</span>}
        </button>
        <button className="icon-button" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight /></button>
      </div>

      <div className="chore-board">
        <div className="chore-grid grid-header">
          <div className="chore-title-cell">My chores</div>
          {days.map((day) => (
            <div className={dateKey(day) === dateKey(new Date()) ? "day-heading today" : "day-heading"} key={dateKey(day)}>
              <span>{day.toLocaleDateString("en-AU", { weekday: "short" })}</span>
              <strong>{day.getDate()}</strong>
            </div>
          ))}
        </div>

        {chores.map((chore) => (
          <div className="chore-grid chore-row" key={chore.id}>
            <div className="chore-name" style={{ "--chore-color": chore.color } as React.CSSProperties}>
              <span className="chore-dot" />
              <div><strong>{chore.name}</strong><small><span className={`category-badge ${chore.category}`}>{chore.category}</span>{chore.category === "bonus" ? `${money(chore.valueCents)} each time` : "Weekly responsibility"}</small></div>
              <button className="edit-chore" onClick={() => openEdit(chore.id)} aria-label={`Edit ${chore.name}`}><Pencil /></button>
              <button className="remove-chore" onClick={() => setChoreToRemove(chore.id)} aria-label={`Remove ${chore.name}`}><Trash2 /></button>
            </div>
            {days.map((day) => {
              const dayKey = dateKey(day);
              const checked = completionKeys.has(`${chore.id}:${dayKey}`);
              return (
                <button
                  key={dayKey}
                  className={checked ? "chore-check checked" : "chore-check"}
                  style={{ "--chore-color": chore.color } as React.CSSProperties}
                  onClick={() => void toggleCompletion(chore.id, dayKey)}
                  aria-label={`${checked ? "Uncheck" : "Check"} ${chore.name} on ${day.toLocaleDateString("en-AU", { weekday: "long" })}`}
                  aria-pressed={checked}
                >
                  <span>{checked && <Check strokeWidth={4} />}</span>
                </button>
              );
            })}
          </div>
        ))}

        {chores.length === 0 && (
          <div className="empty-chores"><Sparkles /><h2>Ready for a new quest?</h2><p>Add Joshua's first chore below.</p></div>
        )}
        <footer className="chores-actions app-control-palette">
          <button className="button primary" onClick={openAdd}><Plus /> Add a chore</button>
          <button className="button secondary pocket-money-info-button" onClick={() => setShowInfo(true)}><CircleHelp /> How pocket money works</button>
        </footer>
      </div>

      {showAdd && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setShowAdd(false)}>
          <form className="dialog-card add-chore-card chore-editor-card" onSubmit={(event) => void submitChore(event)} onPointerDown={(event) => event.stopPropagation()}>
            <div className="dialog-symbol add"><Plus /></div>
            <h2>Add a new chore</h2>
            <ChoreCategoryPicker value={category} onChange={setCategory} />
            <div className="chore-form-fields">
              <label><span>What needs doing?</span><input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" placeholder="Tap here to enter a chore" autoFocus /></label>
              {category === "bonus" && <label><span>Bonus money each time</span><div className="money-input"><b>$</b><input type="text" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" enterKeyHint="done" /></div></label>}
            </div>
            <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="button primary" type="submit" disabled={!name.trim()}>Add chore</button></div>
          </form>
        </div>
      )}

      {choreToEdit && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setChoreToEdit(null)}>
          <form className="dialog-card chore-editor-card" onSubmit={(event) => void submitRename(event)} onPointerDown={(event) => event.stopPropagation()}>
            <div className="dialog-symbol edit"><Pencil /></div>
            <h2>Edit chore</h2>
            <ChoreCategoryPicker value={category} onChange={setCategory} />
            <label><span>Chore name</span><input type="text" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" autoCapitalize="sentences" enterKeyHint="done" autoFocus /></label>
            {category === "bonus" && <label><span>Bonus money each time</span><div className="money-input"><b>$</b><input type="text" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" enterKeyHint="done" /></div></label>}
            <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setChoreToEdit(null)}>Cancel</button><button className="button primary" type="submit" disabled={!name.trim()}>Save chore</button></div>
          </form>
        </div>
      )}

      {showInfo && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setShowInfo(false)}>
          <section className="dialog-card pocket-money-card" role="dialog" aria-modal="true" aria-labelledby="pocket-money-title" onPointerDown={(event) => event.stopPropagation()}>
            <div className="dialog-symbol info"><CircleHelp /></div>
            <h2 id="pocket-money-title">How pocket money works</h2>
            <div className="category-explanations">
              <div className="standard"><strong>Standard</strong><p>Regular family responsibilities that need doing for the weekly pocket-money routine. They do not pay per check.</p></div>
              <div className="bonus"><strong>Bonus</strong><p>Optional extra jobs. Every completed check earns the amount shown on that chore.</p></div>
            </div>
            <ul>
              <li>Payday is Sunday afternoon.</li>
              <li>The weekly $3 is split into $1 Spend, $1 Grow and $1 Give.</li>
              <li>Joshua chooses which jar receives his Bonus money.</li>
              <li>Grow earns a 10% monthly Dad Bank bonus.</li>
            </ul>
            <button className="button primary" onClick={() => setShowInfo(false)}>Got it</button>
          </section>
        </div>
      )}

      <ConfirmDialog open={choreToRemove !== null} title="Remove this chore?" confirmLabel="Remove chore" onCancel={() => setChoreToRemove(null)} onConfirm={() => { if (choreToRemove) void removeChore(choreToRemove); setChoreToRemove(null); }}>
        This removes the chore from Joshua's board. Existing weekly totals may change.
      </ConfirmDialog>
    </section>
  );
}
