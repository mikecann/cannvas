import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
  Power,
  CloudSun,
  CloudOff,
  LoaderCircle,
  Sun,
} from "lucide-react";
import { CalendarApp } from "./apps/CalendarApp";
import { ChoresApp } from "./apps/ChoresApp";
import { DisplayApp } from "./apps/DisplayApp";
import { KioskInventoryApp } from "./apps/KioskInventoryApp";
import { SammyTabletTickerApp } from "./apps/SammyTabletTickerApp";
import { SolarApp } from "./apps/SolarApp";
import { TodosApp } from "./apps/TodosApp";
import { WhiteboardApp } from "./apps/WhiteboardApp";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { useDeviceStatus } from "./data/DataProvider";
import type { BackupStatus } from "./data/types";
import { POWER_OFF_RECOVERY_MESSAGE, schedulePowerOffRecovery } from "./lib/actionTiming";
import { dismissNativeKeyboard, installNativeKeyboard } from "./lib/nativeKeyboard";
import { useHeartbeat } from "./lib/useHeartbeat";
import { useNightDim } from "./lib/useNightDim";

// Leaflet and the bigger dashboards load only when first opened.
const WeatherApp = lazy(() => import("./apps/WeatherApp").then((module) => ({ default: module.WeatherApp })));
const HomeAutomationApp = lazy(() => import("./apps/HomeAutomationApp").then((module) => ({ default: module.HomeAutomationApp })));

type AppId =
  | "whiteboard"
  | "chores"
  | "todos"
  | "calendar"
  | "weather"
  | "solar"
  | "home-automation"
  | "sammy-tablets"
  | "inventory"
  | "display";

const primaryApps = [
  { id: "whiteboard" as const, label: "Whiteboard", icon: PencilLine },
  { id: "chores" as const, label: "Joshua's chores", icon: CheckSquare2 },
  { id: "todos" as const, label: "To-do's", icon: ListTodo },
  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { id: "weather" as const, label: "Weather", icon: CloudSun },
  { id: "solar" as const, label: "Solar", icon: Sun },
  { id: "home-automation" as const, label: "Home controls", icon: HousePlug },
];

const moreApps = [
  { id: "sammy-tablets" as const, label: "Sammy", description: "Tablet schedule", icon: Dog },
  { id: "inventory" as const, label: "Inventory", description: "Find household items", icon: PackageSearch },
];

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000;

export function App() {
  const { isReady, backupStatus } = useDeviceStatus();
  useHeartbeat();
  const [activeApp, setActiveApp] = useState<AppId>("whiteboard");
  const [displaySession, setDisplaySession] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [powerOffOpen, setPowerOffOpen] = useState(false);
  const [powerOffPending, setPowerOffPending] = useState(false);
  const [powerOffError, setPowerOffError] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const moreWrap = useRef<HTMLDivElement>(null);
  const lastInteractiveApp = useRef<AppId>("whiteboard");
  const idleTimer = useRef<number | undefined>(undefined);
  const idleTimeout = Number(import.meta.env.VITE_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT;

  const openDisplay = useCallback(() => {
    // A focused field can be unmounted without firing focusout. Hide the native
    // keyboard explicitly so it never covers the idle display.
    dismissNativeKeyboard();
    // This also fires when the display is already active. Give DisplayApp an
    // explicit reset signal so an idle timeout always mutes the video again.
    setDisplaySession((session) => session + 1);
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

  const requestPowerOff = () => {
    setMoreOpen(false);
    setPowerOffError("");
    setPowerOffOpen(true);
  };

  const powerOff = async () => {
    setPowerOffPending(true);
    setPowerOffError("");
    const recoveryTimer = schedulePowerOffRecovery({
      recover: () => {
        setPowerOffPending(false);
        setPowerOffError(POWER_OFF_RECOVERY_MESSAGE);
      },
    });
    try {
      const response = await fetch("/api/system/poweroff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "poweroff" }),
      });
      if (!response.ok) throw new Error("Cannvas did not accept the power-off request");
    } catch (error) {
      window.clearTimeout(recoveryTimer);
      setPowerOffPending(false);
      setPowerOffError(error instanceof Error ? error.message : "Cannvas could not power off");
    }
  };

  const moreActive = moreApps.some(({ id }) => id === activeApp);

  return (
    <main
      className={`app-shell app-${activeApp}`}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={wake}
    >
      <div className="app-stage" aria-live="polite">
        {/* Only a brand new screen waits here, while its backup is restored. */}
        {!isReady && <RestoringCard backupStatus={backupStatus} />}
        {isReady && (
          <Suspense fallback={<div className="loading-card"><LoaderCircle className="spin" /></div>}>
            {activeApp === "whiteboard" && <WhiteboardApp />}
            {activeApp === "chores" && <ChoresApp />}
            {activeApp === "todos" && <TodosApp />}
            {activeApp === "calendar" && <CalendarApp />}
            {activeApp === "weather" && <WeatherApp />}
            {activeApp === "solar" && <SolarApp />}
            {activeApp === "home-automation" && <HomeAutomationApp />}
            {activeApp === "sammy-tablets" && <SammyTabletTickerApp />}
            {activeApp === "inventory" && <KioskInventoryApp />}
            {activeApp === "display" && <DisplayApp displaySession={displaySession} onActivity={resetIdleTimer} onOpenCalendar={() => openApp("calendar")} onOpenWeather={() => openApp("weather")} onOpenSolar={() => openApp("solar")} />}
          </Suspense>
        )}
      </div>

      {backupStatus.state === "error" && isReady && activeApp !== "display" && (
        <div className="backup-error-badge" role="status" title={backupStatus.message}>
          <span className="backup-error-icon"><CloudOff /></span>
          <span>
            <strong>Backup paused</strong>
            <small>Everything is still saved on this screen</small>
          </span>
        </div>
      )}

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
                <button className="more-power-button" onClick={requestPowerOff}>
                  <span className="more-app-icon"><Power /></span>
                  <span><strong>Turn off Cannvas</strong><small>Shut down the screen safely</small></span>
                </button>
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

      <ConfirmDialog
        open={powerOffOpen}
        title="Turn off Cannvas?"
        confirmLabel={powerOffPending ? "Turning off…" : "Turn off"}
        confirmDisabled={powerOffPending}
        onCancel={() => {
          if (powerOffPending) return;
          setPowerOffOpen(false);
          setPowerOffError("");
        }}
        onConfirm={() => void powerOff()}
      >
        <p>This safely shuts down the Cannvas computer. You will need to turn its power back on to start it again.</p>
        {powerOffError && <p className="dialog-error">{powerOffError}</p>}
      </ConfirmDialog>

      <NightDimOverlay />
    </main>
  );
}

function RestoringCard({ backupStatus }: { backupStatus: BackupStatus }) {
  return (
    <div className="loading-card restoring-card" role="status">
      <LoaderCircle className="spin" />
      <strong>Opening Cannvas…</strong>
      <span>{backupStatus.state === "error"
        ? "This screen is new, so it's fetching its backup first. It can't reach the backup yet and will keep trying."
        : "This screen is new, so it's fetching its backup first."}</span>
    </div>
  );
}

// Its own component, so the minute tick and touch wake never re-render the app.
function NightDimOverlay() {
  const level = useNightDim();
  return <div className="night-dim" aria-hidden="true" style={{ opacity: level }} />;
}
