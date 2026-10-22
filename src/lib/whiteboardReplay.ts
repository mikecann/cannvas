import type { Stroke } from "../data/types";

export const REPLAY_FADE_MS = 600;
export const REPLAY_POINT_MS = 12;
export const REPLAY_STICKER_MS = 200;
// Finish at six seconds, leaving four seconds of the existing ten-second slide.
const MAX_REPLAY_MS = 5400;

export function whiteboardReplay(strokes: Stroke[]) {
  let total = 0;
  const entries = strokes.filter((stroke) => stroke.points.length > 0).map((stroke) => {
    const start = total;
    const sticker = stroke.kind === "sticker" && Boolean(stroke.sticker);
    total += sticker ? REPLAY_STICKER_MS : stroke.points.length * REPLAY_POINT_MS;
    return { stroke, sticker, start, end: total };
  });
  return { entries, total, duration: Math.min(MAX_REPLAY_MS, total) };
}

export type WhiteboardReplay = ReturnType<typeof whiteboardReplay>;

export function replayPosition(replay: WhiteboardReplay, elapsed: number) {
  if (replay.duration === 0) return replay.total;
  const progress = Math.max(0, Math.min(1, (elapsed - REPLAY_FADE_MS) / replay.duration));
  return (1 - Math.cos(Math.PI * progress)) / 2 * replay.total;
}

// Inverse of the eased point count, so a sticker's pop starts at its own turn.
export function replayTime(replay: WhiteboardReplay, position: number) {
  if (replay.total === 0) return REPLAY_FADE_MS;
  const progress = Math.max(0, Math.min(1, position / replay.total));
  return REPLAY_FADE_MS + Math.acos(1 - 2 * progress) / Math.PI * replay.duration;
}
