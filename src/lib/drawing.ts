import type { Point, Stroke } from "../data/types";

function toCanvas(point: Point, width: number, height: number) {
  return { x: point.x * width, y: point.y * height };
}

// Draws the stroke from point `from` onwards. Pen colours are opaque, so a
// stroke drawn in pieces looks the same as one drawn as a single path.
export function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number, from = 0) {
  if (stroke.points.length === 0 || from >= stroke.points.length) return;
  if (stroke.kind === "sticker" && stroke.sticker) {
    const point = toCanvas(stroke.points[0], width, height);
    context.save();
    context.font = `${stroke.width}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(stroke.sticker, point.x, point.y);
    context.restore();
    return;
  }
  context.beginPath();
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  const start = toCanvas(stroke.points[Math.max(0, from - 1)], width, height);
  context.moveTo(start.x, start.y);
  for (let index = Math.max(1, from); index < stroke.points.length; index += 1) {
    const point = toCanvas(stroke.points[index], width, height);
    context.lineTo(point.x, point.y);
  }
  if (stroke.points.length === 1) context.lineTo(start.x + 0.01, start.y + 0.01);
  context.stroke();
}

// Runs `paint` in CSS pixels on a canvas sized in device pixels.
export function paintScaled(canvas: HTMLCanvasElement, paint: (context: CanvasRenderingContext2D, width: number, height: number) => void) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio;
  context.save();
  context.scale(ratio, ratio);
  paint(context, canvas.width / ratio, canvas.height / ratio);
  context.restore();
}
