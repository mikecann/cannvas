/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  // Kiosk only. Must match CANNVAS_DEVICE_TOKEN in Convex.
  readonly VITE_CANNVAS_DEVICE_TOKEN?: string;
  readonly VITE_CANNVAS_DEVICE_ID?: string;
  readonly VITE_IDLE_TIMEOUT_MS?: string;
  // Set only by deploy/deploy.sh, which is what turns Sentry on (src/sentry.ts).
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
