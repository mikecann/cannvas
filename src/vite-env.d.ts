/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL?: string;
  readonly VITE_CANNVAS_TODO_ACCESS_TOKEN?: string;
  readonly VITE_IDLE_TIMEOUT_MS?: string;
  readonly VITE_CALENDAR_ACCESS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
