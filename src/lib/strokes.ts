import type { Point, Stroke } from "../data/types";

// Points are stored normalized to 0..1 of the canvas. Four decimals is about
// 0.2px on the 1920px tall display, so rounding is invisible.
const PRECISION = 10_000;
// Pointer events fire far more often than a finger moves a visible distance.
// Points closer than roughly one display pixel add size without adding shape.
const MIN_POINT_DISTANCE = 0.0005;

function roundPoint({ x, y }: Point): Point {
  return { x: Math.round(x * PRECISION) / PRECISION, y: Math.round(y * PRECISION) / PRECISION };
}

export function compactStroke(stroke: Stroke): Stroke {
  if (stroke.kind === "sticker" || stroke.points.length <= 1) {
    return { ...stroke, points: stroke.points.map(roundPoint) };
  }
  const points: Point[] = [];
  for (const raw of stroke.points) {
    const point = roundPoint(raw);
    const last = points.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) continue;
    points.push(point);
  }
  // Always end where the finger lifted, even if that last move was tiny.
  const end = roundPoint(stroke.points.at(-1)!);
  const last = points.at(-1)!;
  if (last.x !== end.x || last.y !== end.y) points.push(end);
  return { ...stroke, points };
}

export function compactStrokes(strokes: Stroke[]): Stroke[] {
  return strokes.map(compactStroke);
}
