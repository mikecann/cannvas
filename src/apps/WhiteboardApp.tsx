import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
  Palette,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useCannvasData } from "../data/DataProvider";
import type { Point, Stroke } from "../data/types";
import { addDays, dateKey, fromDateKey, longDate } from "../lib/dates";
import { drawStroke, paintScaled } from "../lib/drawing";

const COLORS = ["#20252b", "#f05b52", "#f5a623", "#168b70", "#3478d4", "#894fc7"];
const STICKERS = ["⭐", "❤️", "😊", "🌈", "🦖", "🚀", "⚽", "🐾"];
type DrawingTool = "pen" | "eraser" | "sticker";

const BOARD_BACKGROUND = "#fffdf8";

export function WhiteboardApp() {
  const { boardDates, getBoard, saveBoard } = useCannvasData();
  const [selectedDate, setSelectedDate] = useState(dateKey(new Date()));
  const [strokes, setStrokes] = useState<Stroke[]>(() => getBoard(selectedDate));
  const [redoStack, setRedoStack] = useState<Stroke[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [lineWidth, setLineWidth] = useState(5);
  const [tool, setTool] = useState<DrawingTool>("pen");
  const [sticker, setSticker] = useState(STICKERS[0]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Finished strokes live on this offscreen layer. Moving a finger only draws
  // the new part of the live stroke on top, instead of the whole board.
  const layerRef = useRef<HTMLCanvasElement | null>(null);
  const layerStrokes = useRef<Stroke[] | null>(null);
  const activeStrokes = useRef(new Map<number, Stroke>());
  const drawnPoints = useRef(new Map<number, number>());
  const activeErasers = useRef(new Set<number>());
  const frame = useRef<number | undefined>(undefined);
  const strokesRef = useRef(strokes);
  const getBoardRef = useRef(getBoard);
  getBoardRef.current = getBoard;

  // Only a new date loads a board. The provider rebuilds getBoard on every
  // save, so depending on it would wipe the redo stack straight after undo.
  useEffect(() => {
    const next = getBoardRef.current(selectedDate);
    setStrokes(next);
    strokesRef.current = next;
    setRedoStack([]);
  }, [selectedDate]);

  const drawLiveStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paintScaled(canvas, (context, width, height) => {
      for (const [contactId, stroke] of activeStrokes.current) {
        const from = drawnPoints.current.get(contactId) ?? 0;
        if (from >= stroke.points.length) continue;
        drawStroke(context, stroke, width, height, from);
        drawnPoints.current.set(contactId, stroke.points.length);
      }
    });
  }, []);

  const scheduleLiveDraw = useCallback(() => {
    frame.current ??= window.requestAnimationFrame(() => {
      frame.current = undefined;
      drawLiveStrokes();
    });
  }, [drawLiveStrokes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const layer = layerRef.current ?? document.createElement("canvas");
    layerRef.current = layer;
    if (layer.width !== canvas.width) layer.width = canvas.width;
    if (layer.height !== canvas.height) layer.height = canvas.height;
    const layerContext = layer.getContext("2d");
    const context = canvas.getContext("2d");
    if (!layerContext || !context) return;
    layerContext.fillStyle = BOARD_BACKGROUND;
    layerContext.fillRect(0, 0, layer.width, layer.height);
    paintScaled(layer, (scaled, width, height) => {
      for (const stroke of strokesRef.current) drawStroke(scaled, stroke, width, height);
    });
    layerStrokes.current = strokesRef.current;
    context.drawImage(layer, 0, 0);
    // Strokes still being drawn are repainted in full on the fresh board.
    drawnPoints.current.clear();
    drawLiveStrokes();
  }, [drawLiveStrokes]);

  // Adds a finished stroke to the offscreen layer without repainting the board.
  const commitStroke = (stroke: Stroke, next: Stroke[], alsoOnScreen: boolean) => {
    const layer = layerRef.current;
    if (layer && layerStrokes.current === strokesRef.current) {
      paintScaled(layer, (context, width, height) => drawStroke(context, stroke, width, height));
      if (alsoOnScreen && canvasRef.current) {
        paintScaled(canvasRef.current, (context, width, height) => drawStroke(context, stroke, width, height));
      }
      layerStrokes.current = next;
    }
    strokesRef.current = next;
    setStrokes(next);
  };

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * window.devicePixelRatio);
    canvas.height = Math.round(rect.height * window.devicePixelRatio);
    redraw();
  }, [redraw]);

  useLayoutEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [resize]);

  useEffect(() => () => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    // Strokes added by commitStroke are already on the layer.
    if (layerStrokes.current !== strokes) redraw();
  }, [redraw, strokes]);

  const pointFromClient = (clientX: number, clientY: number): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const startContact = (contactId: number, point: Point) => {
    if (tool === "sticker") {
      const stamp: Stroke = {
        id: crypto.randomUUID(),
        kind: "sticker",
        color,
        width: 72,
        points: [point],
        sticker,
      };
      const next = [...strokesRef.current, stamp];
      commitStroke(stamp, next, true);
      setRedoStack([]);
      void saveBoard(selectedDate, next);
      return;
    }
    if (tool === "eraser") {
      activeErasers.current.add(contactId);
      eraseAt(point);
      return;
    }
    activeStrokes.current.set(contactId, {
      id: crypto.randomUUID(),
      kind: "stroke",
      color,
      width: lineWidth,
      points: [point],
    });
    drawnPoints.current.set(contactId, 0);
    setRedoStack([]);
    scheduleLiveDraw();
  };

  const continueContact = (contactId: number, point: Point) => {
    if (activeErasers.current.has(contactId)) {
      eraseAt(point);
      return;
    }
    const stroke = activeStrokes.current.get(contactId);
    if (!stroke) return;
    stroke.points.push(point);
    scheduleLiveDraw();
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startContact(event.pointerId, pointFromClient(event.clientX, event.clientY));
  };

  const continueDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    continueContact(event.pointerId, pointFromClient(event.clientX, event.clientY));
  };

  const finishDrawing = async (pointerId: number) => {
    if (activeErasers.current.delete(pointerId)) return;
    const stroke = activeStrokes.current.get(pointerId);
    if (!stroke) return;
    // Put the last few points on screen before the stroke leaves the live set.
    drawLiveStrokes();
    activeStrokes.current.delete(pointerId);
    drawnPoints.current.delete(pointerId);
    const next = [...strokesRef.current, stroke];
    commitStroke(stroke, next, false);
    await saveBoard(selectedDate, next);
  };

  const eraseAt = (point: Point) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const radius = 34;
    const isNear = (candidate: Point) => Math.hypot(
      (candidate.x - point.x) * rect.width,
      (candidate.y - point.y) * rect.height,
    ) <= radius;
    const next = strokesRef.current.filter((stroke) => !stroke.points.some(isNear));
    if (next.length === strokesRef.current.length) return;
    strokesRef.current = next;
    setStrokes(next);
    setRedoStack([]);
    void saveBoard(selectedDate, next);
  };

  const undo = async () => {
    const removed = strokes.at(-1);
    if (!removed) return;
    const next = strokes.slice(0, -1);
    setRedoStack((current) => [...current, removed]);
    setStrokes(next);
    await saveBoard(selectedDate, next);
  };

  const redo = async () => {
    const restored = redoStack.at(-1);
    if (!restored) return;
    const next = [...strokes, restored];
    setRedoStack((current) => current.slice(0, -1));
    setStrokes(next);
    await saveBoard(selectedDate, next);
  };

  const clear = async () => {
    setStrokes([]);
    setRedoStack([]);
    setConfirmClear(false);
    await saveBoard(selectedDate, []);
  };

  const nearbyDates = Array.from({ length: 7 }, (_, index) =>
    dateKey(addDays(fromDateKey(selectedDate), index - 3)),
  );

  return (
    <section className="whiteboard-app">
      <header className="whiteboard-header">
        <div>
          <p className="eyebrow">Daily whiteboard</p>
          <h1>{longDate(selectedDate)}</h1>
        </div>
      </header>

      <div className="canvas-wrap">
        <canvas
          ref={canvasRef}
          aria-label={`Whiteboard for ${longDate(selectedDate)}`}
          onPointerDown={startDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={(event) => void finishDrawing(event.pointerId)}
          onPointerCancel={(event) => void finishDrawing(event.pointerId)}
        />
        {strokes.length === 0 && <div className="canvas-hint">Draw something for today</div>}
        <div className="whiteboard-floating-controls">
          <div className="whiteboard-date-controls app-control-palette">
        <button className="icon-button" aria-label="Previous day" onClick={() => setSelectedDate(dateKey(addDays(fromDateKey(selectedDate), -1)))}>
          <ChevronLeft />
        </button>
        <div className="date-strip" aria-label="Nearby whiteboards">
          {nearbyDates.map((day) => (
            <button key={day} className={day === selectedDate ? "date-chip selected" : "date-chip"} onClick={() => setSelectedDate(day)}>
              <span>{fromDateKey(day).toLocaleDateString("en-AU", { weekday: "short" })}</span>
              <strong>{fromDateKey(day).getDate()}</strong>
              <i className={boardDates.includes(day) ? "has-drawing" : ""} />
            </button>
          ))}
        </div>
        <button className="icon-button" aria-label="Next day" onClick={() => setSelectedDate(dateKey(addDays(fromDateKey(selectedDate), 1)))}>
          <ChevronRight />
        </button>
        <label className="date-picker">
          <span>Choose date</span>
          <strong>{fromDateKey(selectedDate).toLocaleDateString("en-AU")}</strong>
          <input aria-label="Choose date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
          </div>

          <div className="drawing-tools app-control-palette">
        <div className="tool-menu-wrap">
          {toolsOpen && (
            <div className="whiteboard-tool-tray" role="menu" aria-label="Whiteboard tools">
              <div className="tool-mode-row">
                <button className={tool === "pen" ? "tray-tool selected" : "tray-tool"} onClick={() => { setTool("pen"); setToolsOpen(false); }}><Pencil /> Pen</button>
                <button className={tool === "eraser" ? "tray-tool selected" : "tray-tool"} onClick={() => { setTool("eraser"); setToolsOpen(false); }}><Eraser /> Eraser</button>
              </div>
              <p>Stickers</p>
              <div className="sticker-tools">
                {STICKERS.map((value) => (
                  <button key={value} className={tool === "sticker" && sticker === value ? "sticker-button selected" : "sticker-button"} onClick={() => { setSticker(value); setTool("sticker"); setToolsOpen(false); }} aria-label={`Use ${value} sticker`}>{value}</button>
                ))}
              </div>
            </div>
          )}
          <button className={toolsOpen ? "tool-button tools-button selected" : "tool-button tools-button"} aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
            <Palette /> Tools
          </button>
        </div>
        <div className="color-tools" aria-label="Pen colours">
          {COLORS.map((value) => (
            <button
              key={value}
              className={value === color ? "color-swatch selected" : "color-swatch"}
              style={{ "--swatch": value } as React.CSSProperties}
              onClick={() => setColor(value)}
              aria-label={`Use ${value}`}
            />
          ))}
        </div>
        <div className="width-tools">
          {[3, 5, 9].map((value) => (
            <button key={value} className={value === lineWidth ? "width-button selected" : "width-button"} onClick={() => setLineWidth(value)}>
              <Circle fill="currentColor" size={value + 5} />
            </button>
          ))}
        </div>
        <div className="history-tools">
          <button className="tool-button" onClick={() => void undo()} disabled={strokes.length === 0}><RotateCcw /> Undo</button>
          <button className="tool-button" onClick={() => void redo()} disabled={redoStack.length === 0}><RotateCcw className="flip-horizontal" /> Redo</button>
          <button className="tool-button danger-text" onClick={() => setConfirmClear(true)} disabled={strokes.length === 0}><Trash2 /> Clear</button>
        </div>
          </div>
        </div>
      </div>

      <ConfirmDialog open={confirmClear} title="Clear this whiteboard?" confirmLabel="Clear board" onCancel={() => setConfirmClear(false)} onConfirm={() => void clear()}>
        Everything drawn on {longDate(selectedDate)} will be removed.
      </ConfirmDialog>
    </section>
  );
}
