import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The kiosk build for the Pi (`pnpm build:mirror`). It includes the device
// token, so its dist/ output must never be published. The public website is
// built by vite.public.config.ts into dist-public/.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
  },
  build: {
    rollupOptions: {
      input: {
        cannvas: resolve(import.meta.dirname, "index.html"),
        apps: resolve(import.meta.dirname, "apps/index.html"),
        giveaway: resolve(import.meta.dirname, "giveaway/index.html"),
        inventory: resolve(import.meta.dirname, "inventory/index.html"),
      },
    },
  },
});
