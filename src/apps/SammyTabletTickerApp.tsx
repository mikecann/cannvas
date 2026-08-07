import { CalendarDays, Check, HeartPulse, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useCannvasData } from "../data/DataProvider";
import type { TabletSchedule } from "../data/types";

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
  const latestByTablet = useMemo(() => new Map(tabletSchedules.map((tablet) => [
    tablet.id,
    [...tabletCompletions].reverse().find((completion) => completion.tabletId === tablet.id),
  ])), [tabletCompletions, tabletSchedules]);

  return (
    <section className="sammy-tablets-app">
      <header className="sammy-tablets-header">
        <div className="sammy-title-icon"><HeartPulse /></div>
        <div>
          <h1>Sammy Tablet Ticker</h1>
          <p>Set each next dose, then tick it off when Sammy has had it.</p>
        </div>
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
                <label className="tablet-date-field">
                  <CalendarDays />
                  <span>
                    <small>Next due</small>
                    <strong>{tablet.dueDate ? formatDate(tablet.dueDate) : "Tap to set a date"}</strong>
                  </span>
                  <input
                    type="date"
                    value={tablet.dueDate ?? ""}
                    onChange={(event) => void setTabletDueDate(tablet.id, event.target.value)}
                    aria-label={`Next due date for ${tablet.name}`}
                  />
                </label>
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
                  <button onClick={() => void undoTabletCompletion(tablet.id)}><RotateCcw /> Undo</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
