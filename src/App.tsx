import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Cctv,
  CheckSquare2,
  Dog,
  Ellipsis,
  HousePlug,
  Keyboard,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  PackageSearch,
  PencilLine,
  Power,
  SlidersHorizontal,
  CloudSun,
  CloudOff,
  LoaderCircle,
  Sun,
} from "lucide-react";
import { AdminApp } from "./apps/AdminApp";
import { CalendarApp } from "./apps/CalendarApp";
import { ChoresApp } from "./apps/ChoresApp";
import { DisplayApp } from "./apps/DisplayApp";
import { KioskInventoryApp } from "./apps/KioskInventoryApp";
import { SammyCamApp } from "./apps/SammyCamApp";
import { SammyTabletTickerApp } from "./apps/SammyTabletTickerApp";
import { SolarApp } from "./apps/SolarApp";
import { TodosApp } from "./apps/TodosApp";
import { WhiteboardApp } from "./apps/WhiteboardApp";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DoorbellAlert } from "./components/DoorbellAlert";
import { VoiceOverlay } from "./components/VoiceOverlay";
import { useDeviceStatus } from "./data/DataProvider";
import type { BackupStatus } from "./data/types";
import { HOME_ASSISTANT_POWER_OFF_RECOVERY_MS, POWER_OFF_RECOVERY_MESSAGE, schedulePowerOffRecovery } from "./lib/actionTiming";
import { runHomeAssistantAction } from "./lib/homeAssistantAction";
import { dismissNativeKeyboard, installNativeKeyboard } from "./lib/nativeKeyboard";
import { SCREEN_WAKE_EVENT } from "./lib/nightDim";
import { useHeartbeat } from "./lib/useHeartbeat";
import { useNightDim } from "./lib/useNightDim";

// Leaflet and the bigger dashboards load only when first opened.
const WeatherApp = lazy(() => import("./apps/WeatherApp").then((module) => ({ default: module.WeatherApp })));
const HomeAutomationApp = lazy(() => import("./apps/HomeAutomationApp").then((module) => ({ default: module.HomeAutomationApp })));
// Chef's request sheet. It signs in with the device token, so only the kiosk
// build against a backend has it.
const ChefSheet = lazy(() => import("./components/ChefSheet").then((module) => ({ default: module.ChefSheet })));
const CHEF_ENABLED = Boolean(import.meta.env.VITE_CONVEX_URL && import.meta.env.VITE_CANNVAS_DEVICE_TOKEN?.trim());

type AppId =
  | "whiteboard"
  | "chores"
  | "todos"
  | "calendar"
  | "weather"
  | "solar"
  | "home-automation"
  | "sammy-tablets"
  | "sammy-cam"
  | "admin"
  | "inventory"
  | "display";

const primaryApps = [
  { id: "whiteboard" as const, label: "Whiteboard", icon: PencilLine },
  { id: "chores" as const, label: "Joshua's chores", icon: CheckSquare2 },
  { id: "todos" as const, label: "To-do's", icon: ListTodo },
  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { id: "weather" as const, label: "Weather", icon: CloudSun },
  { id: "home-automation" as const, label: "Home controls", icon: HousePlug },
];

// Things used less often. The home screen's solar readout still opens Solar.
const moreApps = [
  { id: "solar" as const, label: "Solar", description: "Power right now and today", icon: Sun },
  { id: "sammy-tablets" as const, label: "Sammy", description: "Tablet schedule", icon: Dog },
  { id: "sammy-cam" as const, label: "Sammy Cam", description: "Live view and last night", icon: Cctv },
  { id: "inventory" as const, label: "Inventory", description: "Find household items", icon: PackageSearch },
  { id: "admin" as const, label: "Admin", description: "Wake word training", icon: SlidersHorizontal },
];

// A Home Assistant script that shuts the Pi down cleanly, then cuts the smart
// plug feeding the TV and Pi until the 06:00 automation turns it back on.
const POWER_OFF_SCRIPT = "script.cannvas_power_off";

const appIds = new Set<string>([...primaryApps, ...moreApps].map(({ id }) => id));
const isAppId = (value: string): value is AppId => value === "display" || appIds.has(value);

const DEFAULT_IDLE_TIMEOUT = 5 * 60 * 1000;
// Touches inside Sammy Cam's page never reach Cannvas, and wake word training
// is done by talking from across the room, so the usual timeout would send
// someone home halfway through scrubbing back through the night or recording.
const SLOW_IDLE_APPS = new Set<AppId>(["sammy-cam", "admin"]);
const SLOW_IDLE_TIMEOUT = 30 * 60 * 1000;

export function App() {
  const { isReady, backupStatus } = useDeviceStatus();
  useHeartbeat();
  const [activeApp, setActiveApp] = useState<AppId>("whiteboard");
  const [displaySession, setDisplaySession] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chefOpen, setChefOpen] = useState(false);
  const [powerOffOpen, setPowerOffOpen] = useState(false);
  const [powerOffPending, setPowerOffPending] = useState(false);
  const [powerOffError, setPowerOffError] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const moreWrap = useRef<HTMLDivElement>(null);
  const lastInteractiveApp = useRef<AppId>("whiteboard");
  // What the idle timer is timing. State lags a render behind openApp.
  const shownApp = useRef<AppId>("whiteboard");
  const idleTimer = useRef<number | undefined>(undefined);
  const idleTimeout = Number(import.meta.env.VITE_IDLE_TIMEOUT_MS) || DEFAULT_IDLE_TIMEOUT;

  const openDisplay = useCallback(() => {
    // A focused field can be unmounted without firing focusout. Hide the native
    // keyboard explicitly so it never covers the idle display.
    dismissNativeKeyboard();
    setChefOpen(false);
    // This also fires when the display is already active. Give DisplayApp an
    // explicit reset signal so an idle timeout always mutes the video again.
    setDisplaySession((session) => session + 1);
    shownApp.current = "display";
    setActiveApp("display");
  }, []);

  const resetIdleTimer = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      openDisplay();
    }, SLOW_IDLE_APPS.has(shownApp.current) ? Math.max(idleTimeout, SLOW_IDLE_TIMEOUT) : idleTimeout);
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
      shownApp.current = app;
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
    const recover = () => {
      setPowerOffPending(false);
      setPowerOffError(POWER_OFF_RECOVERY_MESSAGE);
    };
    try {
      await runHomeAssistantAction(POWER_OFF_SCRIPT, "turn_on", "Home Assistant did not respond");
      schedulePowerOffRecovery({ delayMs: HOME_ASSISTANT_POWER_OFF_RECOVERY_MS, recover });
      return;
    } catch {
      // Without Home Assistant, still shut the Pi down. The TV stays powered.
    }
    const recoveryTimer = schedulePowerOffRecovery({ recover });
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
          <AppErrorBoundary key={activeApp}>
            <Suspense fallback={<div className="loading-card"><LoaderCircle className="spin" /></div>}>
              {activeApp === "whiteboard" && <WhiteboardApp />}
              {activeApp === "chores" && <ChoresApp />}
              {activeApp === "todos" && <TodosApp />}
              {activeApp === "calendar" && <CalendarApp />}
              {activeApp === "weather" && <WeatherApp />}
              {activeApp === "solar" && <SolarApp />}
              {activeApp === "home-automation" && <HomeAutomationApp />}
              {activeApp === "sammy-tablets" && <SammyTabletTickerApp />}
              {activeApp === "sammy-cam" && <SammyCamApp />}
              {activeApp === "admin" && <AdminApp />}
              {activeApp === "inventory" && <KioskInventoryApp />}
              {activeApp === "display" && <DisplayApp displaySession={displaySession} onActivity={resetIdleTimer} onOpenCalendar={() => openApp("calendar")} onOpenWeather={() => openApp("weather")} onOpenSolar={() => openApp("solar")} />}
            </Suspense>
          </AppErrorBoundary>
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
                {CHEF_ENABLED && (
                  <button className="more-chef-button" onClick={() => { setMoreOpen(false); setChefOpen(true); }}>
                    <span className="more-app-icon"><Lightbulb /></span>
                    <span><strong>Suggest a feature</strong><small>Ask for something new on Cannvas</small></span>
                  </button>
                )}
                <button className="more-power-button" onClick={requestPowerOff}>
                  <span className="more-app-icon"><Power /></span>
                  <span><strong>Turn off Cannvas</strong><small>And the TV, until 6am</small></span>
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
        <p>This safely shuts down Cannvas and turns off the TV. Cannvas comes back on by itself at 6am.</p>
        {powerOffError && <p className="dialog-error">{powerOffError}</p>}
      </ConfirmDialog>

      <VoiceOverlay
        // Hearing the wake word counts as activity, but stays on the same screen.
        onWake={() => {
          window.dispatchEvent(new Event(SCREEN_WAKE_EVENT));
          resetIdleTimer();
        }}
        onOpenApp={(app) => {
          if (isAppId(app)) openApp(app);
        }}
      />

      {chefOpen && (
        <Suspense fallback={null}>
          <ChefSheet keyboardVisible={keyboardVisible} onClose={() => setChefOpen(false)} />
        </Suspense>
      )}

      <NightDimOverlay />
      {/* Above the evening dimming, so a visitor is never missed. */}
      <DoorbellAlert />
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
