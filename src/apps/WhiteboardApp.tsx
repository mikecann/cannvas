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

const COLORS = ["#20252b", "#f05b52", "#f5a623", "#168b70", "#3478d4", "#894fc7"];
const STICKERS = ["⭐", "❤️", "😊", "🌈", "🦖", "🚀", "⚽", "🐾"];
type DrawingTool = "pen" | "eraser" | "sticker";

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length === 0) return;
  if (stroke.kind === "sticker" && stroke.sticker) {
    const point = stroke.points[0];
    context.save();
    context.font = `${stroke.width}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(stroke.sticker, point.x * width, point.y * height);
    context.restore();
    return;
  }
  context.beginPath();
  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  const first = stroke.points[0];
  context.moveTo(first.x * width, first.y * height);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height);
  if (stroke.points.length === 1) context.lineTo(first.x * width + 0.01, first.y * height + 0.01);
  context.stroke();
}

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
  const activeStrokes = useRef(new Map<number, Stroke>());
  const activeErasers = useRef(new Set<number>());
  const strokesRef = useRef(strokes);

  useEffect(() => {
    const next = getBoard(selectedDate);
    setStrokes(next);
    strokesRef.current = next;
    setRedoStack([]);
  }, [getBoard, selectedDate, boardDates]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.scale(window.devicePixelRatio, window.devicePixelRatio);
    const cssWidth = canvas.width / window.devicePixelRatio;
    const cssHeight = canvas.height / window.devicePixelRatio;
    for (const stroke of strokesRef.current) drawStroke(context, stroke, cssWidth, cssHeight);
    for (const stroke of activeStrokes.current.values()) drawStroke(context, stroke, cssWidth, cssHeight);
    context.restore();
  }, []);

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

  useEffect(() => {
    strokesRef.current = strokes;
    redraw();
  }, [redraw, strokes]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (tool === "sticker") {
      const next = [...strokesRef.current, {
        id: crypto.randomUUID(),
        kind: "sticker" as const,
        color,
        width: 72,
        points: [point],
        sticker,
      }];
      strokesRef.current = next;
      setStrokes(next);
      setRedoStack([]);
      void saveBoard(selectedDate, next);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") {
      activeErasers.current.add(event.pointerId);
      eraseAt(point);
      return;
    }
    activeStrokes.current.set(event.pointerId, {
      id: crypto.randomUUID(),
      kind: "stroke",
      color,
      width: lineWidth,
      points: [point],
    });
    setRedoStack([]);
    redraw();
  };

  const continueDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointFromEvent(event);
    if (activeErasers.current.has(event.pointerId)) {
      eraseAt(point);
      return;
    }
    const stroke = activeStrokes.current.get(event.pointerId);
    if (!stroke) return;
    stroke.points.push(point);
    redraw();
  };

  const finishDrawing = async (pointerId: number) => {
    if (activeErasers.current.delete(pointerId)) return;
    const stroke = activeStrokes.current.get(pointerId);
    if (!stroke) return;
    activeStrokes.current.delete(pointerId);
    const next = [...strokesRef.current, stroke];
    strokesRef.current = next;
    setStrokes(next);
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
      </div>

      <div className="whiteboard-date-controls">
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

      <div className="drawing-tools">
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

      <ConfirmDialog open={confirmClear} title="Clear this whiteboard?" confirmLabel="Clear board" onCancel={() => setConfirmClear(false)} onConfirm={() => void clear()}>
        Everything drawn on {longDate(selectedDate)} will be removed.
      </ConfirmDialog>
    </section>
  );
}
