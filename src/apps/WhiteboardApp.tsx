import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Eraser,
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

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length === 0) return;
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
  const [confirmClear, setConfirmClear] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<Stroke | null>(null);
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
    if (drawing.current) drawStroke(context, drawing.current, cssWidth, cssHeight);
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
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = {
      id: crypto.randomUUID(),
      color,
      width: lineWidth,
      points: [pointFromEvent(event)],
    };
    setRedoStack([]);
    redraw();
  };

  const continueDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current.points.push(pointFromEvent(event));
    redraw();
  };

  const finishDrawing = async () => {
    if (!drawing.current) return;
    const next = [...strokesRef.current, drawing.current];
    drawing.current = null;
    strokesRef.current = next;
    setStrokes(next);
    await saveBoard(selectedDate, next);
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
          onPointerUp={() => void finishDrawing()}
          onPointerCancel={() => void finishDrawing()}
        />
        {strokes.length === 0 && <div className="canvas-hint">Draw something for today</div>}
      </div>

      <div className="whiteboard-date-controls">
        <div className="date-navigation">
          <button className="icon-button" aria-label="Previous day" onClick={() => setSelectedDate(dateKey(addDays(fromDateKey(selectedDate), -1)))}>
            <ChevronLeft />
          </button>
          <label className="date-picker">
            <span>Choose date</span>
            <strong>{fromDateKey(selectedDate).toLocaleDateString("en-AU")}</strong>
            <input aria-label="Choose date" type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <button className="icon-button" aria-label="Next day" onClick={() => setSelectedDate(dateKey(addDays(fromDateKey(selectedDate), 1)))}>
            <ChevronRight />
          </button>
        </div>
        <div className="date-strip" aria-label="Nearby whiteboards">
          {nearbyDates.map((day) => (
            <button key={day} className={day === selectedDate ? "date-chip selected" : "date-chip"} onClick={() => setSelectedDate(day)}>
              <span>{fromDateKey(day).toLocaleDateString("en-AU", { weekday: "short" })}</span>
              <strong>{fromDateKey(day).getDate()}</strong>
              <i className={boardDates.includes(day) ? "has-drawing" : ""} />
            </button>
          ))}
        </div>
      </div>

      <div className="drawing-tools">
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
