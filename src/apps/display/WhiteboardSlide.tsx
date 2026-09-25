import { useLayoutEffect, useRef } from "react";
import type { Stroke } from "../../data/types";
import { drawStroke, paintScaled } from "../../lib/drawing";

// The whiteboard canvas on the portrait screen is about 1024 x 1676 CSS
// pixels. Strokes are stored relative to it, so keep its shape.
const BOARD_ASPECT = 1024 / 1676;

/** Today's drawing, shown full screen for a few seconds between videos. */
export function WhiteboardSlide({ strokes }: { strokes: Stroke[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * window.devicePixelRatio);
      canvas.height = Math.round(rect.height * window.devicePixelRatio);
      // Stroke widths were drawn for the full-size board, so scale them with it.
      const scale = rect.width / 1024;
      paintScaled(canvas, (context, width, height) => {
        for (const stroke of strokes) drawStroke(context, { ...stroke, width: stroke.width * scale }, width, height);
      });
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [strokes]);

  return (
    <div className="whiteboard-slide" role="img" aria-label="Today's whiteboard">
      <p className="eyebrow">Today's whiteboard</p>
      <canvas ref={canvasRef} style={{ aspectRatio: BOARD_ASPECT }} />
    </div>
  );
}
