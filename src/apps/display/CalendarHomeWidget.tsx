import { CheckCircle2, Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCalendar } from "../../data/DataProvider";
import { addCalendarDays, calendarDateKey, calendarEventTime, eventsForDate } from "../../lib/calendar";
import { useMinuteClock } from "../../lib/useMinuteClock";

export function CalendarHomeWidget({ onOpen }: { onOpen: () => void }) {
  const { calendarEvents, calendarStatus } = useCalendar();
  const now = useMinuteClock();
  const [canExpand, setCanExpand] = useState(false);
  const widgetRef = useRef<HTMLElement>(null);
  const todayKey = calendarDateKey(now);
  const todayEvents = useMemo(() => eventsForDate(calendarEvents, todayKey), [calendarEvents, todayKey]);
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    const result = [];
    for (let offset = 1; offset <= 7; offset += 1) {
      const date = addCalendarDays(today, offset);
      const key = calendarDateKey(date);
      for (const event of eventsForDate(calendarEvents, key)) {
        result.push({ event, date, key: `${key}:${event.id}` });
      }
    }
    return result;
    // todayKey stands in for the date, so the list only rebuilds at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarEvents, todayKey]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;
    const updateOverflow = () => setCanExpand(widget.scrollHeight > widget.clientHeight + 1);
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(widget);
    return () => observer.disconnect();
  }, [calendarStatus, todayEvents.length, upcomingEvents.length]);

  return (
    <aside
      ref={widgetRef}
      className={`calendar-home-widget${canExpand ? " has-more" : ""}`}
      aria-label="Open the calendar app"
      role="button"
      tabIndex={0}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <section>
        <h2>Today</h2>
        <div className="calendar-home-list">
          {todayEvents.slice(0, 3).map((event) => {
            const hasPassed = !event.allDay && new Date(event.end) <= now;
            return (
              <article className={hasPassed ? "passed" : undefined} key={event.id} aria-label={`${event.title}, ${calendarEventTime(event)}${hasPassed ? ", passed" : ""}`}>
                <span className="calendar-home-time">{hasPassed && <CheckCircle2 aria-hidden="true" />}{calendarEventTime(event)}</span>
                <strong>{event.title}</strong>
              </article>
            );
          })}
          {calendarStatus === "ready" && todayEvents.length === 0 && <p className="calendar-home-empty">Nothing planned today</p>}
        </div>
      </section>
      <section>
        <h2>Upcoming</h2>
        <div className="calendar-home-list upcoming">
          {upcomingEvents.map(({ event, date, key }) => (
            <article key={key}>
              <span className="calendar-home-day">{date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" })}</span>
              <strong>{event.title}</strong>
              <small><Clock3 /> {calendarEventTime(event)}</small>
            </article>
          ))}
          {calendarStatus === "ready" && upcomingEvents.length === 0 && <p className="calendar-home-empty">Nothing in the next 7 days</p>}
        </div>
      </section>
      {calendarStatus !== "ready" && calendarEvents.length === 0 && (
        <p className="calendar-home-status">{calendarStatus === "not-configured" ? "Connect Google Calendar to see your schedule" : calendarStatus === "error" ? "Calendar is temporarily unavailable" : "Loading calendar…"}</p>
      )}
    </aside>
  );
}
