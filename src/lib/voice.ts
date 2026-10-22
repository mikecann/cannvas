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

/** Who is recording wake word samples, where they are and what they'll say. */
export type TrainingChoice = { speaker: string; spot: string; saying: "wake" | "other" };

export type TrainingState = { active: false } | ({ active: true; endsAt: number } & TrainingChoice);

/** One recorded try, and whether the live model would have woken for it. */
export type VoiceSample = TrainingChoice & {
  id: string;
  at: string;
  score: number;
  wouldWake: boolean;
  heard: string;
  seconds: number;
};

export type VoiceEvent =
  | ({ type: "state" } & VoiceState)
  | { type: "level"; value: number }
  | { type: "command"; name: "open_app"; app: string }
  | ({ type: "training" } & TrainingState)
  | { type: "sample"; sample: VoiceSample };

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
  if (event.type === "training") {
    if (event.active !== true) return { type: "training", active: false };
    const choice = parseChoice(event);
    return choice && typeof event.endsAt === "number" ? { type: "training", active: true, endsAt: event.endsAt, ...choice } : null;
  }
  if (event.type === "sample") {
    const sample = parseVoiceSample(event.sample);
    return sample && { type: "sample", sample };
  }
  return null;
}

function parseChoice(value: Record<string, unknown>): TrainingChoice | null {
  const { speaker, spot, saying } = value;
  if (typeof speaker !== "string" || typeof spot !== "string" || (saying !== "wake" && saying !== "other")) return null;
  return { speaker, spot, saying };
}

/** A sample from the voice service, or null if it isn't one. */
export function parseVoiceSample(value: unknown): VoiceSample | null {
  if (!value || typeof value !== "object") return null;
  const sample = value as Record<string, unknown>;
  const choice = parseChoice(sample);
  if (!choice || typeof sample.id !== "string" || typeof sample.at !== "string" || typeof sample.score !== "number") return null;
  return {
    ...choice,
    id: sample.id,
    at: sample.at,
    score: sample.score,
    wouldWake: sample.wouldWake === true,
    heard: typeof sample.heard === "string" ? sample.heard : "",
    seconds: typeof sample.seconds === "number" ? sample.seconds : 0,
  };
}

export type TrainingTally = {
  /** "Hey Canvas" tries per speaker, and how many would have woken it. */
  wake: { speaker: string; woke: number; tries: number }[];
  /** Other speech, and how much of it would have woken it by mistake. */
  other: { mistakes: number; tries: number };
};

export function trainingTally(samples: VoiceSample[]): TrainingTally {
  const wake = new Map<string, { speaker: string; woke: number; tries: number }>();
  const other = { mistakes: 0, tries: 0 };
  for (const sample of samples) {
    if (sample.saying === "other") {
      other.tries += 1;
      if (sample.wouldWake) other.mistakes += 1;
      continue;
    }
    const row = wake.get(sample.speaker) ?? { speaker: sample.speaker, woke: 0, tries: 0 };
    row.tries += 1;
    if (sample.wouldWake) row.woke += 1;
    wake.set(sample.speaker, row);
  }
  return { wake: [...wake.values()], other };
}
