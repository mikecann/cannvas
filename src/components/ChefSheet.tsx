import { useEffect, useRef, useState } from "react";
import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import type { ChefPanelElement } from "@convex-dev/feedback/panel";
import { api } from "../../convex/_generated/api";

// "Suggest a feature" (More menu): Chef's request sheet, without its floating
// button. Chef's <chef-panel> has no open() or hide-the-button option, so this
// adds the element already open (`open="1"`, its one public way in), restyles
// it from inside its shadow root to sit in the middle of the portrait wall,
// and takes it away again when the panel's own ▾ shrinks it to its button.
// Kiosk only: App.tsx shows the entry only with a Convex URL and the device
// token, and the public build never includes App.tsx.

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;
const DEVICE_TOKEN = import.meta.env.VITE_CANNVAS_DEVICE_TOKEN?.trim() ?? "";
// Chef's panel is sized for a laptop. Scale it up for a TV across the room.
const ZOOM = 1.6;
const DOCK_CLEARANCE = 140;
// Above the keyboard and its "Hide keyboard" button (styles.css).
const KEYBOARD_CLEARANCE = 620 + 24 + 58 + 24;

const SHEET_CSS = `
  :host { zoom: ${ZOOM}; }
  .bubble, .comp {
    left: 50%; right: auto; transform: translateX(-50%);
    width: min(400px, calc(100vw / ${ZOOM} - 48px)); max-width: none;
    max-height: calc((100vh - var(--chef-bottom) * ${ZOOM} - 120px) / ${ZOOM});
    z-index: 105;
  }
  .wn, .toast, .countdown, .ann { z-index: 106; }
  /* "Your Chef user id" is for an owner naming themselves admin. The wall never is. */
  .myid { display: none; }
  .toast, .countdown { left: 50%; right: auto; transform: translateX(-50%); }
`;

let panelLoaded: Promise<unknown> | null = null;
function loadPanel() {
  // The panel uses the app's own Convex client code, not a copy from esm.sh.
  (globalThis as { __chefConvexLib?: unknown }).__chefConvexLib ??= { ConvexClient, makeFunctionReference };
  panelLoaded ??= import("@convex-dev/feedback/panel");
  return panelLoaded;
}

// The wall signs in to Chef as its "cannvas-wall" member with an hour-long
// token it gets for its device token (convex/chefWall.ts).
let wallToken: { token: string; expiresAt: number } | null = null;
async function fetchWallToken({ forceRefreshToken }: { forceRefreshToken: boolean }) {
  if (!forceRefreshToken && wallToken && wallToken.expiresAt - Date.now() > 5 * 60_000) return wallToken.token;
  try {
    wallToken = await new ConvexHttpClient(CONVEX_URL).action(api.chefWall.token, { deviceToken: DEVICE_TOKEN });
    return wallToken.token;
  } catch {
    wallToken = null;
    return null;
  }
}

export function ChefSheet({ keyboardVisible, onClose }: { keyboardVisible: boolean; onClose: () => void }) {
  const [panel, setPanel] = useState<ChefPanelElement | null>(null);
  const [showBackdrop, setShowBackdrop] = useState(true);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let element: ChefPanelElement | null = null;
    let observer: MutationObserver | null = null;
    let cancelled = false;
    void loadPanel().then(() => {
      if (cancelled) return;
      element = document.createElement("chef-panel");
      element.setAttribute("convex-url", CONVEX_URL);
      element.setAttribute("prefix", "chef");
      element.setAttribute("open", "1");
      element.setAttribute("whats-new", "off");
      document.body.appendChild(element);
      const root = element.shadowRoot!;
      const style = document.createElement("style");
      style.textContent = SHEET_CSS;
      root.appendChild(style);
      element.setAuth(fetchWallToken);
      // The panel redraws itself on every update. Its button showing means
      // someone pressed ▾. The dimmed wall behind it hides while a screenshot
      // is being taken, so the picture shows the screen as it is.
      observer = new MutationObserver(() => {
        if (root.querySelector("#fab")) close.current();
        else setShowBackdrop(!!root.querySelector(".bubble") && !root.querySelector(".comp, .countdown"));
      });
      observer.observe(root, { childList: true, subtree: true });
      setPanel(element);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      element?.remove();
    };
  }, []);

  useEffect(() => {
    panel?.setAttribute("offset-bottom", String(Math.round((keyboardVisible ? KEYBOARD_CLEARANCE : DOCK_CLEARANCE) / ZOOM)));
  }, [panel, keyboardVisible]);

  return showBackdrop ? <div className="dialog-backdrop chef-backdrop" role="presentation" /> : null;
}
