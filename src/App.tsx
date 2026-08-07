import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, CheckSquare2, Dog, HousePlug, LayoutDashboard, ListTodo, PencilLine } from "lucide-react";
import { CalendarApp } from "./apps/CalendarApp";
import { ChoresApp } from "./apps/ChoresApp";
import { DisplayApp } from "./apps/DisplayApp";
import { HomeAutomationApp } from "./apps/HomeAutomationApp";
import { SammyTabletTickerApp } from "./apps/SammyTabletTickerApp";
import { TodosApp } from "./apps/TodosApp";
import { WhiteboardApp } from "./apps/WhiteboardApp";
import { useCannvasData } from "./data/DataProvider";
import { installNativeKeyboard } from "./lib/nativeKeyboard";

type AppId = "whiteboard" | "chores" | "todos" | "calendar" | "home-automation" | "sammy-tablets" | "display";

const apps = [
  { id: "whiteboard" as const, label: "Whiteboard", icon: PencilLine },
  { id: "chores" as const, label: "Joshua's chores", icon: CheckSquare2 },
  { id: "todos" as const, label: "To-do's", icon: ListTodo },
  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { id: "home-automation" as const, label: "Home controls", icon: HousePlug },
  { id: "sammy-tablets" as const, label: "Sammy's tablets", icon: Dog },
  { id: "display" as const, label: "Home", icon: LayoutDashboard },
];

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000;

export function App() {
  const { isReady } = useCannvasData();
  const [activeApp, setActiveApp] = useState<AppId>("whiteboard");
  const lastInteractiveApp = useRef<AppId>("whiteboard");
  const idleTimer = useRef<number | undefined>(undefined);
  const idleTimeout = Number(import.meta.env.VITE_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT;

  const resetIdleTimer = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      setActiveApp("display");
    }, idleTimeout);
  }, [idleTimeout]);

  useEffect(() => {
    return installNativeKeyboard();
  }, []);

  useEffect(() => {
    const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown"];
    const onActivity = () => resetIdleTimer();
    for (const event of events) window.addEventListener(event, onActivity, { passive: true });
    resetIdleTimer();
    return () => {
      window.clearTimeout(idleTimer.current);
      for (const event of events) window.removeEventListener(event, onActivity);
    };
  }, [resetIdleTimer]);

  const openApp = (app: AppId) => {
    if (app !== "display") lastInteractiveApp.current = app;
    setActiveApp(app);
    resetIdleTimer();
  };

  const wake = () => {
    if (activeApp === "display") openApp(lastInteractiveApp.current);
  };

  return (
    <main
      className={`app-shell app-${activeApp}`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={wake}
    >
      <div className="app-stage" aria-live="polite">
        {!isReady && <div className="loading-card">Opening Cannvas…</div>}
        {isReady && activeApp === "whiteboard" && <WhiteboardApp />}
        {isReady && activeApp === "chores" && <ChoresApp />}
        {isReady && activeApp === "todos" && <TodosApp />}
        {isReady && activeApp === "calendar" && <CalendarApp />}
        {isReady && activeApp === "home-automation" && <HomeAutomationApp />}
        {isReady && activeApp === "sammy-tablets" && <SammyTabletTickerApp />}
        {isReady && activeApp === "display" && <DisplayApp onOpenCalendar={() => openApp("calendar")} />}
      </div>

      {activeApp !== "display" && (
        <nav className="app-dock" aria-label="Cannvas apps">
          {apps.map(({ id, label, icon: Icon }) => (
            <button
              className={activeApp === id ? "dock-item active" : "dock-item"}
              key={id}
              onClick={() => openApp(id)}
              aria-current={activeApp === id ? "page" : undefined}
            >
              <span className="dock-icon"><Icon strokeWidth={2.4} /></span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </main>
  );
}
