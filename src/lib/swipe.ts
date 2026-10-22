export type Swipe = "left" | "right";

// Far enough, flat enough and quick enough that a tap, a wobbly press or a
// slow drag is never read as a swipe.
export const SWIPE_MIN_PX = 60;
export const SWIPE_MAX_MS = 600;

/** Which way a finger swiped between pressing and lifting, or null for anything else. */
export function classifySwipe(dx: number, dy: number, ms: number): Swipe | null {
  if (ms > SWIPE_MAX_MS || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return null;
  return dx < 0 ? "left" : "right";
}
