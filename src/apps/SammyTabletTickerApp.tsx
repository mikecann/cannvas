import { CalendarDays, Check, ChevronLeft, ChevronRight, HeartPulse, History, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useCannvasData } from "../data/DataProvider";
import type { TabletId, TabletSchedule } from "../data/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function todayKey() {
  const today = new Date();
  return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
}

function fromDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(value: string) {
  return fromDateKey(value).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
}

function dateKey(value: Date) {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function dueState(tablet: TabletSchedule) {
  if (!tablet.dueDate) return { label: "Choose a due date", className: "unset" };
  const days = Math.round((fromDateKey(tablet.dueDate).getTime() - fromDateKey(todayKey()).getTime()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)} day${days === -1 ? "" : "s"} overdue`, className: "overdue" };
  if (days === 0) return { label: "Due today", className: "today" };
  if (days === 1) return { label: "Due tomorrow", className: "soon" };
  return { label: `Due in ${days} days`, className: days <= 14 ? "soon" : "scheduled" };
}

export function SammyTabletTickerApp() {
  const { tabletSchedules, tabletCompletions, setTabletDueDate, completeTablet, undoTabletCompletion } = useCannvasData();
  const [showHistory, setShowHistory] = useState(false);
  const [dateTabletId, setDateTabletId] = useState<TabletId | null>(null);
  const [pickerMonth, setPickerMonth] = useState(() => new Date());
  const latestByTablet = useMemo(() => new Map(tabletSchedules.map((tablet) => [
    tablet.id,
    [...tabletCompletions].reverse().find((completion) => completion.tabletId === tablet.id),
  ])), [tabletCompletions, tabletSchedules]);
  const sortedHistory = useMemo(
    () => [...tabletCompletions].sort((left, right) => right.takenDate.localeCompare(left.takenDate)),
    [tabletCompletions],
  );
  const dateTablet = tabletSchedules.find(({ id }) => id === dateTabletId);
  const pickerDays = useMemo(() => calendarDays(pickerMonth), [pickerMonth]);

  const openDatePicker = (tablet: TabletSchedule) => {
    const initialDate = tablet.dueDate ? fromDateKey(tablet.dueDate) : new Date();
    setPickerMonth(new Date(initialDate.getFullYear(), initialDate.getMonth(), 1));
    setDateTabletId(tablet.id);
  };

  const chooseDate = async (value: string) => {
    if (!dateTabletId) return;
    await setTabletDueDate(dateTabletId, value);
    setDateTabletId(null);
  };

  return (
    <section className="sammy-tablets-app">
      <header className="sammy-tablets-header">
        <div className="sammy-title-icon"><HeartPulse /></div>
        <div>
          <h1>Sammy</h1>
          <p>Set each next dose, then tick it off when Sammy has had it.</p>
        </div>
        <button className="tablet-history-button" onClick={() => setShowHistory(true)}>
          <History />
          View history
          <span>{tabletCompletions.length}</span>
        </button>
      </header>

      <div className="tablet-list">
        {tabletSchedules.map((tablet) => {
          const status = dueState(tablet);
          const latest = latestByTablet.get(tablet.id);
          return (
            <article className={`tablet-card ${status.className}`} key={tablet.id} style={{ "--tablet-color": tablet.color } as React.CSSProperties}>
              <div className="tablet-card-top">
                <div className="tablet-mark"><ShieldCheck /></div>
                <div className="tablet-name">
                  <h2>{tablet.name}</h2>
                  <p>{tablet.purpose} · every {tablet.cadenceMonths === 1 ? "month" : "3 months"}</p>
                </div>
                <span className={`tablet-status ${status.className}`}>{status.label}</span>
              </div>

              <div className="tablet-card-actions">
                <button className="tablet-date-field" onClick={() => openDatePicker(tablet)} aria-label={`Choose next due date for ${tablet.name}`}>
                  <CalendarDays />
                  <span>
                    <small>Next due</small>
                    <strong>{tablet.dueDate ? formatDate(tablet.dueDate) : "Tap to set a date"}</strong>
                  </span>
                </button>
                <button
                  className="tablet-done-button"
                  disabled={!tablet.dueDate}
                  onClick={() => void completeTablet(tablet.id, todayKey())}
                >
                  <Check strokeWidth={3.2} />
                  Mark as given
                </button>
              </div>

              {latest && (
                <div className="tablet-last-given">
                  <span>Last given {formatDate(latest.takenDate)}</span>
                  {latest.previousDueDate !== undefined && (
                    <button onClick={() => void undoTabletCompletion(tablet.id)}><RotateCcw /> Undo</button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {showHistory && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setShowHistory(false)}>
          <section className="dialog-card tablet-history-card" role="dialog" aria-modal="true" aria-labelledby="tablet-history-title" onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="tablet-history-title">Sammy's tablet history</h2>
                <p>{tabletCompletions.length} recorded dose{tabletCompletions.length === 1 ? "" : "s"}</p>
              </div>
              <button className="tablet-history-close" onClick={() => setShowHistory(false)} aria-label="Close tablet history"><X /></button>
            </header>
            <div className="tablet-history-list">
              {sortedHistory.map((completion) => {
                const tablet = tabletSchedules.find(({ id }) => id === completion.tabletId);
                if (!tablet) return null;
                return (
                  <article key={completion.id} style={{ "--tablet-color": tablet.color } as React.CSSProperties}>
                    <span className="tablet-history-dot"><Check /></span>
                    <div><strong>{tablet.name}</strong><small>{tablet.purpose}</small></div>
                    <time dateTime={completion.takenDate}>{formatDate(completion.takenDate)}</time>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {dateTablet && (
        <div className="dialog-backdrop" role="presentation" onPointerDown={() => setDateTabletId(null)}>
          <section className="dialog-card tablet-date-picker-card" role="dialog" aria-modal="true" aria-labelledby="tablet-date-picker-title" onPointerDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="tablet-date-picker-title">Next {dateTablet.name} dose</h2>
                <p>Choose the date Sammy is next due.</p>
              </div>
              <button className="tablet-history-close" onClick={() => setDateTabletId(null)} aria-label="Close date picker"><X /></button>
            </header>

            <div className="tablet-picker-month">
              <button onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() - 1, 1))} aria-label="Previous month"><ChevronLeft /></button>
              <strong>{pickerMonth.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}</strong>
              <button onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 1))} aria-label="Next month"><ChevronRight /></button>
            </div>

            <div className="tablet-picker-weekdays" aria-hidden="true">
              {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
            </div>
            <div className="tablet-picker-grid">
              {pickerDays.map((day) => {
                const key = dateKey(day);
                const outside = day.getMonth() !== pickerMonth.getMonth();
                const selected = key === dateTablet.dueDate;
                const today = key === todayKey();
                return (
                  <button
                    className={`${outside ? "outside" : ""}${selected ? " selected" : ""}${today ? " today" : ""}`}
                    key={key}
                    onClick={() => void chooseDate(key)}
                    aria-label={day.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                    aria-pressed={selected}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <footer className="tablet-picker-actions">
              {dateTablet.dueDate && <button className="button secondary" onClick={() => void chooseDate("")}>Clear date</button>}
              <button className="button primary" onClick={() => void chooseDate(todayKey())}>Today</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
