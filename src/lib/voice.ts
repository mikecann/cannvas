// What the Pi's voice service (deploy/cannvas-voice) tells the page. Kept
// free of React so the parsing can be tested directly.

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking";

export type VoiceState = {
  phase: VoicePhase;
  /** What speech recognition heard, once it has. */
  heard: string;
  /** What Cannvas said back. */
  reply: string;
};

export type VoiceEvent =
  | ({ type: "state" } & VoiceState)
  | { type: "level"; value: number }
  | { type: "command"; name: "open_app"; app: string };

export const IDLE_VOICE: VoiceState = { phase: "idle", heard: "", reply: "" };

const PHASES = new Set<VoicePhase>(["idle", "listening", "thinking", "speaking"]);

/** Parse one server-sent event, ignoring anything unexpected. */
export function parseVoiceEvent(data: string): VoiceEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type === "state" && PHASES.has(event.phase as VoicePhase)) {
    return {
      type: "state",
      phase: event.phase as VoicePhase,
      heard: typeof event.heard === "string" ? event.heard : "",
      reply: typeof event.reply === "string" ? event.reply : "",
    };
  }
  if (event.type === "level" && typeof event.value === "number" && Number.isFinite(event.value)) {
    return { type: "level", value: Math.min(1, Math.max(0, event.value)) };
  }
  if (event.type === "command" && event.name === "open_app" && typeof event.app === "string") {
    return { type: "command", name: "open_app", app: event.app };
  }
  return null;
}
