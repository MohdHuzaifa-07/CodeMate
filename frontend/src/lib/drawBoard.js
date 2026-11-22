// The board has a fixed virtual size. Everything is drawn in these units and scaled to the screen.
export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 900;
// The server accepts 3000 points per stroke; stop a little before that.
export const MAX_POINTS_PER_STROKE = 2900;

function drawDot(ctx, [x, y], size, color) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(size / 2, 0.5), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

export function drawElement(ctx, el) {
  const pts = el?.points;
  if (!Array.isArray(pts) || pts.length === 0) return;

  if (pts.length === 1) return drawDot(ctx, pts[0], el.size, el.color);

  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (el.type === 'rectangle') {
    const [a, b] = pts;
    ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (el.type === 'pencil' && pts.length > 2) {
    // Smooth the stroke by curving through the middle of each pair of points
    for (let i = 1; i < pts.length - 1; i++) {
      const midX = (pts[i][0] + pts[i + 1][0]) / 2;
      const midY = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], midX, midY);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();
}

export function drawBoard(ctx, elements) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  for (const el of elements) drawElement(ctx, el);
}

/** The same person always gets the same color. */
export function cursorColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) % 360;
  return `hsl(${hash}, 70%, 45%)`;
}

export function drawCursors(ctx, cursors) {
  ctx.font = '16px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const c of cursors) {
    const color = cursorColor(c.userId);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + 14, c.y + 6);
    ctx.lineTo(c.x + 6, c.y + 14);
    ctx.closePath();
    ctx.fill();

    const width = ctx.measureText(c.name).width + 12;
    ctx.fillStyle = color;
    ctx.fillRect(c.x + 14, c.y + 12, width, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(c.name, c.x + 20, c.y + 23);
  }
}