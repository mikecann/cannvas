import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

type AppErrorBoundaryProps = { children: ReactNode };
type AppErrorBoundaryState = { failed: boolean };

/**
 * Keeps one broken app, such as a lazy chunk that failed to download after a
 * deploy, from blanking the whole kiosk. The dock, heartbeat and home screen
 * keep working. Give it a key per app so switching apps resets it.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Cannvas app failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="loading-card" role="alert">
        <TriangleAlert />
        <strong>This app hit a snag</strong>
        <span>The rest of Cannvas is fine. Reloading the screen usually sorts it out.</span>
        <button
          className="button secondary"
          // On the home screen a touch would otherwise wake the previous app first.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => window.location.reload()}
        >
          Reload the screen
        </button>
      </div>
    );
  }
}
