import { reactErrorHandler } from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DataProvider } from "./data/DataProvider";
import { sentryEnabled } from "./sentry";
import "./styles.css";

// Errors an error boundary catches (one app crashing) never reach the global
// error handler, so hand them to Sentry here. AppErrorBoundary still logs them.
createRoot(document.getElementById("root")!, sentryEnabled ? { onCaughtError: reactErrorHandler() } : undefined).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);
