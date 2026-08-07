import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckSquare2,
  Dog,
  Ellipsis,
  HousePlug,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  PackageSearch,
  PencilLine,
} from "lucide-react";
import { CalendarApp } from "./apps/CalendarApp";
import { ChoresApp } from "./apps/ChoresApp";
import { DisplayApp } from "./apps/DisplayApp";
import { HomeAutomationApp } from "./apps/HomeAutomationApp";
import { KioskInventoryApp } from "./apps/KioskInventoryApp";
import { SammyTabletTickerApp } from "./apps/SammyTabletTickerApp";
import { TodosApp } from "./apps/TodosApp";
import { WhiteboardApp } from "./apps/WhiteboardApp";
import { useCannvasData } from "./data/DataProvider";
import { dismissNativeKeyboard, installNativeKeyboard } from "./lib/nativeKeyboard";

type AppId =
  | "whiteboard"
  | "chores"
  | "todos"
  | "calendar"
  | "home-automation"
  | "sammy-tablets"
  | "inventory"
  | "display";

const primaryApps = [
  { id: "whiteboard" as const, label: "Whiteboard", icon: PencilLine },
  { id: "chores" as const, label: "Joshua's chores", icon: CheckSquare2 },
  { id: "todos" as const, label: "To-do's", icon: ListTodo },
  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { id: "home-automation" as const, label: "Home controls", icon: HousePlug },
];

const moreApps = [
  { id: "sammy-tablets" as const, label: "Sammy", description: "Tablet schedule", icon: Dog },
  { id: "inventory" as const, label: "Inventory", description: "Find household items", icon: PackageSearch },
];

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000;

export function App() {
  const { isReady } = useCannvasData();
  const [activeApp, setActiveApp] = useState<AppId>("whiteboard");
  const [moreOpen, setMoreOpen] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const moreWrap = useRef<HTMLDivElement>(null);
  const lastInteractiveApp = useRef<AppId>("whiteboard");
  const idleTimer = useRef<number | undefined>(undefined);
  const idleTimeout = Number(import.meta.env.VITE_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT;

  const openDisplay = useCallback(() => {
    // A focused field can be unmounted without firing focusout. Hide the native
    // keyboard explicitly so it never covers the idle display.
    dismissNativeKeyboard();
    setActiveApp("display");
  }, []);

  const resetIdleTimer = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      openDisplay();
    }, idleTimeout);
  }, [idleTimeout, openDisplay]);

  useEffect(() => {
    return installNativeKeyboard(setKeyboardVisible);
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

  useEffect(() => {
    if (!moreOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!moreWrap.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithKeyboard);
    };
  }, [moreOpen]);

  const openApp = (app: AppId) => {
    setMoreOpen(false);
    if (app === "display") {
      openDisplay();
    } else {
      lastInteractiveApp.current = app;
      setActiveApp(app);
    }
    resetIdleTimer();
  };

  const wake = () => {
    if (activeApp === "display") openApp(lastInteractiveApp.current);
  };

  const moreActive = moreApps.some(({ id }) => id === activeApp);

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
        {isReady && activeApp === "inventory" && <KioskInventoryApp />}
        {isReady && activeApp === "display" && <DisplayApp onOpenCalendar={() => openApp("calendar")} />}
      </div>

      {keyboardVisible && activeApp !== "display" && (
        <button
          className="keyboard-dismiss-button"
          onClick={dismissNativeKeyboard}
        >
          <Keyboard />
          Hide keyboard
        </button>
      )}

      {activeApp !== "display" && (
        <nav className="app-dock" aria-label="Cannvas apps">
          {primaryApps.map(({ id, label, icon: Icon }) => (
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
          <div className="dock-more-wrap" ref={moreWrap}>
            {moreOpen && (
              <div className="more-apps-popover" role="dialog" aria-label="More apps">
                <div><strong>More apps</strong><span>Things you use less often</span></div>
                {moreApps.map(({ id, label, description, icon: Icon }) => (
                  <button key={id} onClick={() => openApp(id)}>
                    <span className="more-app-icon"><Icon /></span>
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </button>
                ))}
              </div>
            )}
            <button
              className={moreActive ? "dock-item active" : "dock-item"}
              onClick={() => setMoreOpen((open) => !open)}
              aria-current={moreActive ? "page" : undefined}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
            >
              <span className="dock-icon"><Ellipsis strokeWidth={2.4} /></span>
              <span>More</span>
            </button>
          </div>
          <span className="dock-divider" aria-hidden="true" />
          <button
            className="dock-item"
            onClick={() => openApp("display")}
          >
            <span className="dock-icon"><LayoutDashboard strokeWidth={2.4} /></span>
            <span>Home</span>
          </button>
        </nav>
      )}
    </main>
  );
}
