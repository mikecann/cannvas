import * as Sentry from "@sentry/react";

// Sends the wall's own browser errors to Sentry, where a watcher turns serious
// ones into a thread. Agents and dev builds run Cannvas all day and their
// errors must never get there, so this only starts on the real wall:
// - a production build made by deploy/deploy.sh, the only thing that sets
//   VITE_SENTRY_RELEASE (a plain `pnpm build:mirror` leaves it unset);
// - served by cannvas-server on the Pi at 127.0.0.1:4173, the kiosk's URL;
// - in the Pi's Chromium (Linux), not a browser on a Mac previewing dist/;
// - not driven by Playwright or another WebDriver.
const DSN = "https://b1eafc143c19458c1e182f87a33db1b2@o4508736647266304.ingest.us.sentry.io/4512336957014016";
const RELEASE = import.meta.env.VITE_SENTRY_RELEASE;

export const sentryEnabled = Boolean(
  import.meta.env.PROD
  && RELEASE
  && window.location.host === "127.0.0.1:4173"
  && /Linux/.test(navigator.userAgent)
  && !navigator.webdriver,
);

if (sentryEnabled) {
  Sentry.init({
    dsn: DSN,
    environment: "production",
    release: RELEASE,
    initialScope: { tags: { component: "web" } },
    // Errors only: no tracing, replay or profiling on the free plan, and no
    // release-health session ping on every page load.
    tracesSampleRate: 0,
    integrations: (defaults) => defaults.filter((integration) => integration.name !== "BrowserSession"),
    // SDK 11's replacement for sendDefaultPii: false. Send no user, cookie,
    // header, body or query data.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    // Click breadcrumbs carry aria-labels, which hold to-do and calendar
    // titles here. Leave them out so household text never reaches Sentry.
    beforeBreadcrumb: (breadcrumb) => (breadcrumb.category?.startsWith("ui.") ? null : breadcrumb),
  });
}
