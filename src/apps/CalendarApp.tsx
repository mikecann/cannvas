import { CalendarCheck2, ChevronLeft, ChevronRight, Clock3, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCannvasData } from "../data/DataProvider";
import { addCalendarDays, calendarDateKey, calendarEventTime, calendarMonthDays, eventsForDate } from "../lib/calendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarApp() {
  const { calendarEvents, calendarStatus, loadCalendarRange } = useCannvasData();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => calendarDateKey(new Date()));
  const days = useMemo(() => calendarMonthDays(month), [month]);
  const todayKey = calendarDateKey(new Date());
  const selectedEvents = eventsForDate(calendarEvents, selectedDate);
  const nextWeekEnd = addCalendarDays(new Date(), 8);
  const nextWeekCount = calendarEvents.filter((event) => new Date(event.start) < nextWeekEnd && new Date(event.end) > new Date()).length;

  useEffect(() => {
    const rangeEnd = addCalendarDays(days[days.length - 1], 1);
    void loadCalendarRange(days[0].toISOString(), rangeEnd.toISOString());
  }, [days, loadCalendarRange]);

  const moveMonth = (offset: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(calendarDateKey(next));
  };

  const returnToToday = () => {
    const today = new Date();
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(calendarDateKey(today));
  };

  return (
    <section className="calendar-app">
      <header className="calendar-header">
        <div>
          <p className="eyebrow">Our family schedule</p>
          <h1>{month.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}</h1>
          <p className="header-note">Events from Mike's personal Google Calendar.</p>
        </div>
        <div className="calendar-summary-card">
          <CalendarCheck2 />
          <span><strong>{nextWeekCount}</strong> events in the next 7 days</span>
        </div>
      </header>

      <div className="calendar-board">
        <div className="calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">
          {days.map((day) => {
            const key = calendarDateKey(day);
            const dayEvents = eventsForDate(calendarEvents, key);
            const outside = day.getMonth() !== month.getMonth();
            return (
              <button className={`calendar-day${key === selectedDate ? " selected" : ""}${key === todayKey ? " today" : ""}${outside ? " outside" : ""}`} key={key} onClick={() => setSelectedDate(key)}>
                <span className="calendar-day-number">{day.getDate()}</span>
                <div className="calendar-day-events">
                  {dayEvents.slice(0, 3).map((event) => <span className={event.allDay ? "all-day" : ""} key={event.id}><b>{event.allDay ? "" : calendarEventTime(event)}</b>{event.title}</span>)}
                  {dayEvents.length > 3 && <small>+{dayEvents.length - 3} more</small>}
                </div>
              </button>
            );
          })}
        </div>

        <section className="calendar-agenda" aria-label={`Events for ${selectedDate}`}>
          <header><div><span>Selected day</span><h2>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</h2></div><strong>{selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}</strong></header>
          <div className="calendar-agenda-list">
            {selectedEvents.map((event) => (
              <article key={event.id}>
                <span className="calendar-event-accent" />
                <div><h3>{event.title}</h3><p><Clock3 /> {calendarEventTime(event)}{event.location && <><MapPin /> {event.location}</>}</p></div>
              </article>
            ))}
            {selectedEvents.length === 0 && <div className="calendar-empty-day"><CalendarCheck2 /><span>Nothing planned for this day</span></div>}
          </div>
        </section>

        {calendarStatus !== "ready" && calendarEvents.length === 0 && (
          <div className="calendar-connection-state">
            <CalendarCheck2 />
            <strong>{calendarStatus === "not-configured" ? "Google Calendar is ready to connect" : calendarStatus === "error" ? "Calendar is temporarily unavailable" : "Loading calendar…"}</strong>
            {calendarStatus === "not-configured" && <span>Add the primary calendar's secret iCal address to start syncing.</span>}
          </div>
        )}

        <footer className="calendar-actions app-control-palette">
          <button className="icon-button" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft /></button>
          <button className="button secondary" onClick={returnToToday}>Today</button>
          <button className="icon-button" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight /></button>
        </footer>
      </div>
    </section>
  );
}
