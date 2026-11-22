import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket.js';
import { useRoom } from '../context/RoomContext.jsx';
import { useToast } from './Toasts.jsx';
import { BOARD_HEIGHT, BOARD_WIDTH, MAX_POINTS_PER_STROKE, drawBoard, drawCursors } from '../lib/drawBoard.js';

const SEND_EVERY_MS = 40; // how often a stroke in progress is sent
const CURSOR_EVERY_MS = 50;
const CURSOR_IDLE_MS = 4000; // a cursor that stops moving disappears after this
const MIN_POINT_GAP = 1.5; // ignore points closer than this (board units)
const MAX_BATCH = 200;

const TOOLS = [
  ['pencil', '✏️ Pencil'],
  ['line', '╱ Line'],
  ['rectangle', '▭ Rectangle'],
];

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round1 = (n) => Math.round(n * 10) / 10;
const copyElement = (el) => ({ ...el, points: el.points.map((p) => [...p]) });

/** Sends what is waiting for the stroke being drawn. */
function flush(d) {
  clearTimeout(d.timer);
  d.timer = null;
  if (d.pending.length === 0) return;
  if (d.el.type === 'pencil') {
    for (let i = 0; i < d.pending.length; i += MAX_BATCH) {
      socket.emit('board:extend', { id: d.id, points: d.pending.slice(i, i + MAX_BATCH) });
    }
  } else {
    socket.emit('board:extend', { id: d.id, points: [d.pending[d.pending.length - 1]] });
  }
  d.pending = [];
  d.lastSent = performance.now();
}

function queueSend(d) {
  const wait = SEND_EVERY_MS - (performance.now() - d.lastSent);
  if (wait <= 0) flush(d);
  else if (!d.timer) d.timer = setTimeout(() => flush(d), wait);
}

export default function Whiteboard() {
  const { initial, myId, me, users } = useRoom();
  const toast = useToast();

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const elementsRef = useRef([]); // everything on the board
  const cursorsRef = useRef(new Map()); // other people's cursors
  const sizeRef = useRef({ scale: 0, dpr: 1 });
  const rafRef = useRef(0);
  const drawingRef = useRef(null); // the stroke I am drawing right now
  const lastCursorSentRef = useRef(0);

  const [tool, setTool] = useState('pencil');
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(3);
  const [ownCount, setOwnCount] = useState(0); // how many strokes are mine (for the Undo button)
  const [redoCount, setRedoCount] = useState(0);

  const recount = useCallback(
    () => setOwnCount(elementsRef.current.filter((e) => e.ownerId === myId).length),
    [myId],
  );

  const redraw = useCallback(() => {
    rafRef.current = 0;
    const canvas = canvasRef.current;
    const { scale, dpr } = sizeRef.current;
    if (!canvas || !scale) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    drawBoard(ctx, elementsRef.current);
    drawCursors(ctx, [...cursorsRef.current.values()]);
  }, []);

  const scheduleDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(redraw);
  }, [redraw]);

  // Fit the board into the available space, sharp on high-resolution screens
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;

    const fit = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (!width || !height) return; // the tab is hidden
      const scale = Math.min(width / BOARD_WIDTH, height / BOARD_HEIGHT);
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.floor(BOARD_WIDTH * scale);
      const cssH = Math.floor(BOARD_HEIGHT * scale);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      sizeRef.current = { scale: cssW / BOARD_WIDTH, dpr };
      scheduleDraw();
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [scheduleDraw]);

  // Start from the board the server sent us (also again after a reconnect)
  useEffect(() => {
    elementsRef.current = (initial?.board?.elements ?? []).map(copyElement);
    cursorsRef.current.clear();
    setRedoCount(0);
    recount();
    scheduleDraw();
  }, [initial, recount, scheduleDraw]);

  // What other people do on the board
  useEffect(() => {
    const indexOf = (id) => elementsRef.current.findLastIndex((e) => e.id === id);

    const onBegin = (el) => {
      elementsRef.current.push(copyElement(el));
      recount();
      scheduleDraw();
    };
    const onExtend = ({ id, points }) => {
      const el = elementsRef.current[indexOf(id)];
      if (!el) return;
      if (el.type === 'pencil') el.points.push(...points);
      else el.points = [el.points[0], points[points.length - 1]];
      scheduleDraw();
    };
    const onRemove = ({ id }) => {
      const i = indexOf(id);
      if (i === -1) return;
      elementsRef.current.splice(i, 1);
      recount();
      scheduleDraw();
    };
    const onCleared = () => {
      elementsRef.current = [];
      setRedoCount(0);
      recount();
      scheduleDraw();
    };
    const onCursor = ({ userId, name, x, y }) => {
      if (userId === myId) return;
      cursorsRef.current.set(userId, { userId, name, x, y, ts: Date.now() });
      scheduleDraw();
    };

    socket.on('board:begin', onBegin);
    socket.on('board:extend', onExtend);
    socket.on('board:remove', onRemove);
    socket.on('board:add', onBegin); // redo brings a stroke back
    socket.on('board:cleared', onCleared);
    socket.on('board:cursor', onCursor);

    const timer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, c] of cursorsRef.current) {
        if (now - c.ts > CURSOR_IDLE_MS) {
          cursorsRef.current.delete(id);
          changed = true;
        }
      }
      if (changed) scheduleDraw();
    }, 1000);

    return () => {
      socket.off('board:begin', onBegin);
      socket.off('board:extend', onExtend);
      socket.off('board:remove', onRemove);
      socket.off('board:add', onBegin);
      socket.off('board:cleared', onCleared);
      socket.off('board:cursor', onCursor);
      clearInterval(timer);
    };
  }, [myId, recount, scheduleDraw]);

  // Remove the cursors of people who left
  useEffect(() => {
    const ids = new Set(users.map((u) => u.id));
    let changed = false;
    for (const id of cursorsRef.current.keys()) {
      if (!ids.has(id)) {
        cursorsRef.current.delete(id);
        changed = true;
      }
    }
    if (changed) scheduleDraw();
  }, [users, scheduleDraw]);

  // If this component goes away mid-stroke, send what is left
  useEffect(
    () => () => {
      const d = drawingRef.current;
      if (d) flush(d);
      drawingRef.current = null;
    },
    [],
  );

  /** Screen position -> board position. Returns null if the canvas has no size yet. */
  const toBoard = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((e.clientX - rect.left) / rect.width) * BOARD_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * BOARD_HEIGHT;
    return [round1(clamp(x, 0, BOARD_WIDTH)), round1(clamp(y, 0, BOARD_HEIGHT))];
  };

  const sendCursor = (p) => {
    const now = performance.now();
    if (now - lastCursorSentRef.current < CURSOR_EVERY_MS) return;
    lastCursorSentRef.current = now;
    socket.volatile.emit('board:cursor', { x: p[0], y: p[1] });
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 || drawingRef.current) return;
    const p = toBoard(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // Draw on my own screen right away, and tell the server at the same time
    const id = crypto.randomUUID();
    const el = { id, type: tool, color, size, ownerId: myId, points: [p] };
    elementsRef.current.push(el);
    drawingRef.current = { id, el, pending: [], timer: null, lastSent: 0 };
    setRedoCount(0); // drawing something new ends your redo history
    recount();
    scheduleDraw();

    socket.timeout(5000).emit('board:begin', { id, type: tool, color, size, point: p }, (err, res) => {
      if (!err && res?.ok) return;
      // The server said no: take the stroke back off my screen
      const i = elementsRef.current.findLastIndex((x) => x.id === id);
      if (i !== -1) elementsRef.current.splice(i, 1);
      const d = drawingRef.current;
      if (d?.id === id) {
        clearTimeout(d.timer);
        drawingRef.current = null;
      }
      recount();
      scheduleDraw();
      toast(res?.error?.message ?? 'Could not draw. Please try again.', 'warning');
    });
  };

  const onPointerMove = (e) => {
    const p = toBoard(e);
    if (!p) return;
    sendCursor(p);

    const d = drawingRef.current;
    if (!d) return;
    const { el } = d;
    if (el.type === 'pencil') {
      const last = el.points[el.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_POINT_GAP) return;
      if (el.points.length >= MAX_POINTS_PER_STROKE) return;
      el.points.push(p);
      d.pending.push(p);
    } else {
      el.points = [el.points[0], p];
      d.pending = [p];
    }
    scheduleDraw();
    queueSend(d);
  };

  const finishStroke = () => {
    const d = drawingRef.current;
    if (!d) return;
    flush(d);
    drawingRef.current = null;
  };

  const undo = () =>
    socket.timeout(5000).emit('board:undo', {}, (err, res) => {
      if (err || !res?.ok) return toast(res?.error?.message ?? 'Could not undo.', 'secondary');
      setRedoCount((n) => n + 1);
    });

  const redo = () =>
    socket.timeout(5000).emit('board:redo', {}, (err, res) => {
      if (err || !res?.ok) {
        if (res?.error?.code === 'NOTHING_TO_REDO') setRedoCount(0);
        return toast(res?.error?.message ?? 'Could not redo.', 'secondary');
      }
      setRedoCount((n) => Math.max(0, n - 1));
    });

  const clearBoard = () => {
    if (!window.confirm('Clear the whole board for everyone?')) return;
    socket.timeout(5000).emit('board:clear', {}, (err, res) => {
      if (err || !res?.ok) toast(res?.error?.message ?? 'Could not clear the board.', 'warning');
    });
  };

  return (
    <div className="d-flex flex-column fill">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <div className="btn-group" role="group" aria-label="Drawing tool">
          {TOOLS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm ${tool === value ? 'btn-primary' : 'btn-outline-primary'}`}
              aria-pressed={tool === value}
              onClick={() => setTool(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="d-flex align-items-center gap-1 mb-0">
          <span className="small">Color</span>
          <input
            type="color"
            className="form-control form-control-color form-control-sm"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>

        <label className="d-flex align-items-center gap-1 mb-0">
          <span className="small">Size {size}</span>
          <input
            type="range"
            className="form-range"
            style={{ width: 110 }}
            min="1"
            max="30"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>

        <span className="ms-auto d-flex gap-1">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={undo} disabled={ownCount === 0}>
            Undo
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={redo} disabled={redoCount === 0}>
            Redo
          </button>
          {me?.isHost && (
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={clearBoard}>
              Clear
            </button>
          )}
        </span>
      </div>

      <div ref={wrapRef} className="board-wrap border rounded position-relative">
        <canvas
          ref={canvasRef}
          className="board-canvas"
          role="img"
          aria-label="Shared whiteboard"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
        />
      </div>
    </div>
  );
}