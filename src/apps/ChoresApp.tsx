import { Check, ChevronLeft, ChevronRight, Plus, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useCannvasData } from "../data/DataProvider";
import { addDays, dateKey, fromDateKey, money, startOfWeek } from "../lib/dates";

export function ChoresApp() {
  const { chores, completions, addChore, removeChore, toggleCompletion, clearWeek } = useCannvasData();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [showAdd, setShowAdd] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [choreToRemove, setChoreToRemove] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [value, setValue] = useState("0.50");
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const completionKeys = useMemo(
    () => new Set(completions.map(({ choreId, date }) => `${choreId}:${date}`)),
    [completions],
  );
  const weekDates = new Set(days.map(dateKey));
  const earned = completions.reduce((total, completion) => {
    if (!weekDates.has(completion.date)) return total;
    return total + (chores.find((chore) => chore.id === completion.choreId)?.valueCents ?? 0);
  }, 0);
  const possible = chores.reduce((total, chore) => total + chore.valueCents * 7, 0);
  const isThisWeek = dateKey(weekStart) === dateKey(startOfWeek(new Date()));

  const submitChore = async (event: React.FormEvent) => {
    event.preventDefault();
    const valueCents = Math.round(Number(value) * 100);
    if (!name.trim() || !Number.isFinite(valueCents) || valueCents < 0) return;
    await addChore(name.trim(), valueCents);
    setName("");
    setValue("0.50");
    setShowAdd(false);
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
          <span>Earned this week</span>
          <strong>{money(earned)}</strong>
          <div className="reward-progress"><span style={{ width: `${possible ? Math.min(100, (earned / possible) * 100) : 0}%` }} /></div>
          <small>{money(possible)} possible</small>
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
              <div><strong>{chore.name}</strong><small>{money(chore.valueCents)} each time</small></div>
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
      </div>

      <footer className="chores-actions">
        <button className="button primary" onClick={() => setShowAdd(true)}><Plus /> Add a chore</button>
        <button className="button quiet-danger" onClick={() => setShowClear(true)} disabled={earned === 0}><Trash2 /> Clear this week</button>
      </footer>

      {showAdd && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setShowAdd(false)}>
          <form className="dialog-card add-chore-card" onSubmit={(event) => void submitChore(event)} onPointerDown={(event) => event.stopPropagation()}>
            <div className="dialog-symbol add"><Plus /></div>
            <h2>Add a new chore</h2>
            <label><span>What needs doing?</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Put away the dishes" /></label>
            <label><span>Pocket money each time</span><div className="money-input"><b>$</b><input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /></div></label>
            <div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="button primary" type="submit" disabled={!name.trim()}>Add chore</button></div>
          </form>
        </div>
      )}

      <ConfirmDialog open={showClear} title="Clear this week's checks?" confirmLabel="Clear the week" onCancel={() => setShowClear(false)} onConfirm={() => { void clearWeek(dateKey(weekStart)); setShowClear(false); }}>
        This removes every tick for this week. The chore list will stay ready for next week.
      </ConfirmDialog>

      <ConfirmDialog open={choreToRemove !== null} title="Remove this chore?" confirmLabel="Remove chore" onCancel={() => setChoreToRemove(null)} onConfirm={() => { if (choreToRemove) void removeChore(choreToRemove); setChoreToRemove(null); }}>
        This removes the chore from Joshua's board. Existing weekly totals may change.
      </ConfirmDialog>
    </section>
  );
}
