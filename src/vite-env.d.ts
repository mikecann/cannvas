/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  // Kiosk only. Must match CANNVAS_DEVICE_TOKEN in Convex.
  readonly VITE_CANNVAS_DEVICE_TOKEN?: string;
  readonly VITE_CANNVAS_DEVICE_ID?: string;
  readonly VITE_IDLE_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
