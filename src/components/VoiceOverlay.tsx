import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { useVoice, type VoiceHandlers } from "../lib/useVoice";
import type { VoicePhase } from "../lib/voice";

/** How long a reply stays readable after Cannvas finishes speaking. */
const LINGER_MS = 8_000;

const LABELS: Record<VoicePhase, string> = {
  idle: "Cannvas",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Cannvas",
};

/**
 * Shows what voice commands are doing. Its own component, so the microphone
 * level updating ten times a second never re-renders the app.
 */
export function VoiceOverlay(handlers: VoiceHandlers) {
  const { phase, heard, reply, level, listen, cancel } = useVoice(handlers);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (phase !== "idle") {
      setHidden(false);
      return;
    }
    const timer = window.setTimeout(() => setHidden(true), reply ? LINGER_MS : 0);
    return () => window.clearTimeout(timer);
  }, [phase, reply]);

  if (phase === "idle" && hidden) return null;

  const done = phase === "idle" || phase === "speaking";
  return (
    <div
      className={`voice-overlay voice-${phase}`}
      role="status"
      aria-live="polite"
      onPointerDown={(event) => {
        // A touch on the card stops the reply and puts it away.
        if ((event.target as HTMLElement).closest("button")) return;
        cancel();
        setHidden(true);
      }}
    >
      <span className="voice-orb" aria-hidden="true" style={{ transform: `scale(${1 + level * 0.6})` }}>
        <Mic />
      </span>
      <span className="voice-text">
        <small>{LABELS[phase]}</small>
        {phase === "listening" && <strong className="voice-hint">Go ahead, I'm listening</strong>}
        {phase === "thinking" && <strong>{heard ? `“${heard}”` : "…"}</strong>}
        {done && heard && <em>“{heard}”</em>}
        {done && reply && <strong>{reply}</strong>}
      </span>
      {phase === "idle" && (
        <button className="voice-again" onClick={listen} aria-label="Say something else">
          <Mic />
        </button>
      )}
    </div>
  );
}
