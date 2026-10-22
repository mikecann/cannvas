import { useLayoutEffect, useRef } from "react";
import type { Stroke } from "../../data/types";
import { drawStroke, paintScaled } from "../../lib/drawing";
import { REPLAY_POINT_MS, REPLAY_STICKER_MS, replayPosition, replayTime, whiteboardReplay } from "../../lib/whiteboardReplay";

// The whiteboard canvas on the portrait screen is about 1024 x 1676 CSS
// pixels. Strokes are stored relative to it, so keep its shape.
const BOARD_ASPECT = 1024 / 1676;
const MAX_POINTS_PER_FRAME = 2048;
const MAX_STROKES_PER_FRAME = 64;

/** Today's drawing, shown full screen for a few seconds between videos. */
export function WhiteboardSlide({ strokes }: { strokes: Stroke[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stickerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const sticker = stickerRef.current;
    if (!canvas || !sticker) return;
    const replay = whiteboardReplay(strokes);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const startedAt = performance.now();
    let frame: number | undefined;
    let index = 0;
    let drawn = 0;
    let scale = 1;
    let target = 0;
    let popping: Stroke | undefined;
    let pop: Animation | undefined;
    // Once reduced motion is enabled, keep this slide still even if it changes back.
    let still = motion.matches || replay.entries.length === 0;

    const hideSticker = () => {
      sticker.hidden = true;
      popping = undefined;
      pop?.cancel();
      pop = undefined;
    };

    const paint = (elapsed: number) => {
      let pointsLeft = MAX_POINTS_PER_FRAME;
      let strokesLeft = MAX_STROKES_PER_FRAME;
      const deadline = performance.now() + 4;
      paintScaled(canvas, (context, width, height) => {
        while (index < replay.entries.length && pointsLeft > 0 && strokesLeft > 0 && performance.now() < deadline) {
          const entry = replay.entries[index];
          const scaledStroke = { ...entry.stroke, width: entry.stroke.width * scale };
          // Hold later ink until the sticker is committed, preserving overlap order.
          if (entry.sticker && target > entry.start && target < entry.end) {
            if (popping !== entry.stroke) {
              hideSticker();
              popping = entry.stroke;
              sticker.textContent = entry.stroke.sticker!;
              sticker.style.left = `${entry.stroke.points[0].x * 100}%`;
              sticker.style.top = `${entry.stroke.points[0].y * 100}%`;
              sticker.style.fontSize = `${scaledStroke.width}px`;
              sticker.style.color = entry.stroke.color;
              sticker.hidden = false;
              const start = replayTime(replay, entry.start);
              const duration = Math.min(REPLAY_STICKER_MS, replayTime(replay, entry.end) - start);
              pop = sticker.animate([
                { transform: "translate(-50%, -50%) scale(.3) rotate(-6deg)" },
                { transform: "translate(-50%, -50%) scale(1.15) rotate(6deg)", offset: .65 },
                { transform: "translate(-50%, -50%) scale(1) rotate(0deg)" },
              ], { duration, easing: "ease-out", fill: "both" });
              pop.currentTime = Math.max(0, elapsed - start);
            }
            break;
          }
          const count = entry.sticker
            ? (target >= entry.end ? 1 : 0)
            : Math.min(entry.stroke.points.length, Math.floor((target - entry.start) / REPLAY_POINT_MS));
          if (count <= drawn) break;
          hideSticker();
          const to = Math.min(count, drawn + pointsLeft);
          drawStroke(context, scaledStroke, width, height, drawn, to);
          pointsLeft -= to - drawn;
          drawn = to;
          if (drawn < (entry.sticker ? 1 : entry.stroke.points.length)) break;
          index += 1;
          drawn = 0;
          strokesLeft -= 1;
        }
      });
    };

    const tick = (now: number) => {
      frame = undefined;
      const elapsed = now - startedAt;
      target = replayPosition(replay, elapsed);
      paint(elapsed);
      if (index < replay.entries.length) frame = window.requestAnimationFrame(tick);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * window.devicePixelRatio);
      canvas.height = Math.round(rect.height * window.devicePixelRatio);
      scale = rect.width / 1024;
      hideSticker();
      index = 0;
      drawn = 0;
      if (still) {
        paintScaled(canvas, (context, width, height) => {
          for (const stroke of strokes) drawStroke(context, { ...stroke, width: stroke.width * scale }, width, height);
        });
      } else {
        // Rebuild only the revealed prefix after a resize, within the same frame
        // budget as playback. Never flash the finished board during the replay.
        paint(performance.now() - startedAt);
        frame ??= window.requestAnimationFrame(tick);
      }
    };

    const reduceMotion = () => {
      if (!motion.matches) return;
      still = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      resize();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    motion.addEventListener("change", reduceMotion);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", reduceMotion);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      hideSticker();
    };
  }, [strokes]);

  return (
    <div className="whiteboard-slide" role="img" aria-label="Today's whiteboard">
      <p className="eyebrow">Today's whiteboard</p>
      <div className="whiteboard-slide-board" style={{ aspectRatio: BOARD_ASPECT }}>
        <canvas ref={canvasRef} />
        <span ref={stickerRef} className="whiteboard-slide-sticker" hidden aria-hidden="true" />
      </div>
    </div>
  );
}
