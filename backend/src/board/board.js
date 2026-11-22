export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;

const TYPES = new Set(['pencil', 'line', 'rectangle']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_BATCH = 200; // points accepted in one update
const MAX_REDO_HISTORY = 50;
const MIN_SIZE = 1;
const MAX_SIZE = 30;

const round1 = (n) => Math.round(n * 10) / 10;
const ok = (extra = {}) => ({ ok: true, ...extra });
const no = (code, message) => ({ ok: false, code, message });

/** Returns a cleaned [x, y], or null if it is not a number pair on the board. */
export function cleanPoint(p) {
  if (!Array.isArray(p) || p.length !== 2) return null;
  const [x, y] = p;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > BOARD_WIDTH || y < 0 || y > BOARD_HEIGHT) return null;
  return [round1(x), round1(y)];
}

/**
 * One whiteboard per room. It is a list of vector elements, not an image:
 *   pencil    -> points: every point of the stroke
 *   line      -> points: [start, end]
 *   rectangle -> points: [corner, opposite corner]
 * Each element remembers who drew it (ownerId), which is what makes
 * "undo only my own strokes" possible.
 */
export class Board {
  constructor({ maxElements = 3000, maxPointsPerElement = 3000 } = {}) {
    this.maxElements = maxElements;
    this.maxPointsPerElement = maxPointsPerElement;
    this.elements = [];
    this.redoStacks = new Map(); // ownerId -> removed elements, newest last
  }

  begin(ownerId, data) {
    const { id, type, color, size } = data ?? {};
    if (typeof id !== 'string' || !ID_RE.test(id)) return no('BAD_ID', 'Invalid stroke id');
    if (this.#indexOf(id) !== -1) return no('DUPLICATE_ID', 'That stroke id is already used');
    if (!TYPES.has(type)) return no('BAD_TYPE', 'Unknown tool');
    if (typeof color !== 'string' || !COLOR_RE.test(color)) return no('BAD_COLOR', 'Color must look like #1a2b3c');
    if (!Number.isFinite(size) || size < MIN_SIZE || size > MAX_SIZE) {
      return no('BAD_SIZE', `Size must be ${MIN_SIZE}-${MAX_SIZE}`);
    }
    const point = cleanPoint(data?.point);
    if (!point) return no('BAD_POINT', 'Point is outside the board');
    if (this.elements.length >= this.maxElements) return no('BOARD_FULL', 'The board is full');

    const element = { id, type, color: color.toLowerCase(), size, ownerId, points: [point] };
    this.elements.push(element);
    this.redoStacks.delete(ownerId); // drawing something new ends your redo history
    return ok({ element });
  }

  /** Pencil: appends points. Line/rectangle: moves the end point. Only the owner may do it. */
  extend(ownerId, id, points) {
    const element = this.elements[typeof id === 'string' ? this.#indexOf(id) : -1];
    if (!element) return no('NOT_FOUND', 'Stroke not found');
    if (element.ownerId !== ownerId) return no('NOT_OWNER', 'You can only edit your own strokes');
    if (!Array.isArray(points) || points.length === 0 || points.length > MAX_BATCH) {
      return no('BAD_POINTS', `Send 1-${MAX_BATCH} points at a time`);
    }
    const clean = [];
    for (const p of points) {
      const c = cleanPoint(p);
      if (!c) return no('BAD_POINT', 'Point is outside the board');
      clean.push(c);
    }

    if (element.type === 'pencil') {
      if (element.points.length + clean.length > this.maxPointsPerElement) {
        return no('TOO_LONG', 'This stroke is too long');
      }
      element.points.push(...clean);
      return ok({ points: clean });
    }
    const end = clean[clean.length - 1];
    element.points = [element.points[0], end];
    return ok({ points: [end] });
  }

  /** Removes the owner's most recent element. */
  undo(ownerId) {
    const index = this.elements.findLastIndex((e) => e.ownerId === ownerId);
    if (index === -1) return no('NOTHING_TO_UNDO', 'Nothing to undo');
    const [element] = this.elements.splice(index, 1);
    const stack = this.redoStacks.get(ownerId) ?? [];
    stack.push(element);
    if (stack.length > MAX_REDO_HISTORY) stack.shift();
    this.redoStacks.set(ownerId, stack);
    return ok({ id: element.id });
  }

  /** Brings back the owner's most recently undone element. */
  redo(ownerId) {
    const stack = this.redoStacks.get(ownerId);
    if (!stack?.length) return no('NOTHING_TO_REDO', 'Nothing to redo');
    if (this.elements.length >= this.maxElements) return no('BOARD_FULL', 'The board is full');
    const element = stack.pop();
    this.elements.push(element);
    return ok({ element });
  }

  clear() {
    this.elements = [];
    this.redoStacks.clear();
  }

  snapshot() {
    return { width: BOARD_WIDTH, height: BOARD_HEIGHT, elements: this.elements };
  }

  #indexOf(id) {
    return this.elements.findLastIndex((e) => e.id === id);
  }
}