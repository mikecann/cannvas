import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The public website (Cloudflare) only has the app launcher, inventory and
// giveaway pages. The kiosk is built separately by vite.config.ts and only
// ever served from the Pi, so its device token never reaches the internet.
const OUT_DIR = "dist-public";
const KIOSK_ONLY_ENV = [
  "VITE_CANNVAS_DEVICE_TOKEN",
  // Old names, still checked in case they linger in a local .env file.
  "VITE_CALENDAR_ACCESS_TOKEN",
  "VITE_CANNVAS_TODO_ACCESS_TOKEN",
];
const KIOSK_ONLY_MODULES = ["/src/main.tsx", "/src/kioskMain.tsx", "/src/App.tsx", "/src/data/DataProvider.tsx"];

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

// Fail the build rather than publish anything kiosk-only.
function guardPublicBuild(secrets: string[]): Plugin {
  const root = import.meta.dirname;
  return {
    name: "cannvas-public-build-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const kioskModule = chunk.moduleIds.find((id) => KIOSK_ONLY_MODULES.some((module) => id.endsWith(module)));
        if (kioskModule) this.error(`Kiosk module ${relative(root, kioskModule)} ended up in the public build (${chunk.fileName}).`);
      }
    },
    closeBundle() {
      const outDir = resolve(root, OUT_DIR);
      for (const file of listFiles(outDir)) {
        const contents = readFileSync(file);
        for (const secret of secrets) {
          if (contents.includes(secret)) {
            throw new Error(`A kiosk-only token value was found in ${relative(root, file)}. Refusing to publish it.`);
          }
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  const secrets = KIOSK_ONLY_ENV
    .map((name) => (env[name] ?? process.env[name] ?? "").trim())
    .filter((value) => value.length >= 8);
  return {
    plugins: [react(), guardPublicBuild(secrets)],
    // Belt and braces: even if public code referenced a kiosk token by
    // mistake, it would compile to undefined here.
    define: Object.fromEntries(KIOSK_ONLY_ENV.map((name) => [`import.meta.env.${name}`, "undefined"])),
    build: {
      outDir: OUT_DIR,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          apps: resolve(import.meta.dirname, "apps/index.html"),
          giveaway: resolve(import.meta.dirname, "giveaway/index.html"),
          inventory: resolve(import.meta.dirname, "inventory/index.html"),
        },
      },
    },
  };
});
