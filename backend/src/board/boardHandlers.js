import { fail } from '../util/ack.js';
import { cleanPoint } from './board.js';

const RATE_MAX = 150; // board events per user...
const RATE_WINDOW_MS = 1000; // ...per second
const CURSOR_THROTTLE_MS = 40;

function allowed(user) {
  const now = Date.now();
  const w = user.boardWindow;
  if (!w || now - w.start >= RATE_WINDOW_MS) {
    user.boardWindow = { start: now, count: 1 };
    return true;
  }
  w.count += 1;
  return w.count <= RATE_MAX;
}

export function registerBoardHandlers(io, store) {
  io.on('connection', (socket) => {
    const noop = () => {};
    const replyFn = (ack) => (typeof ack === 'function' ? ack : noop);

    // Start a new element. Others get the full element (with ownerId).
    socket.on('board:begin', (payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      if (!allowed(user)) return fail(reply, 'RATE_LIMITED', 'Slow down a little');

      const result = room.board.begin(user.id, payload);
      if (!result.ok) return fail(reply, result.code, result.message);
      socket.to(room.id).emit('board:begin', result.element);
      reply({ ok: true });
    });

    // Keep drawing. No ack: this is sent many times a second.
    socket.on('board:extend', (payload) => {
      const member = store.memberOf(socket.id);
      if (!member) return;
      const { room, user } = member;
      if (!allowed(user)) return;

      const result = room.board.extend(user.id, payload?.id, payload?.points);
      if (result.ok) socket.to(room.id).emit('board:extend', { id: payload.id, points: result.points });
    });

    // Undo / redo are confirmed by the server and sent to everyone, including you.
    socket.on('board:undo', (_payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      if (!allowed(user)) return fail(reply, 'RATE_LIMITED', 'Slow down a little');

      const result = room.board.undo(user.id);
      if (!result.ok) return fail(reply, result.code, result.message);
      io.to(room.id).emit('board:remove', { id: result.id });
      reply({ ok: true, id: result.id });
    });

    socket.on('board:redo', (_payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      if (!allowed(user)) return fail(reply, 'RATE_LIMITED', 'Slow down a little');

      const result = room.board.redo(user.id);
      if (!result.ok) return fail(reply, result.code, result.message);
      io.to(room.id).emit('board:add', result.element);
      reply({ ok: true });
    });

    // Only the host can wipe the whole board.
    socket.on('board:clear', (_payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      if (room.hostClientId !== user.clientId) return fail(reply, 'NOT_HOST', 'Only the host can clear the board');

      room.board.clear();
      io.to(room.id).emit('board:cleared');
      reply({ ok: true });
    });

    // Live cursors. Fine to lose some, so they are sent as "volatile".
    socket.on('board:cursor', (payload) => {
      const member = store.memberOf(socket.id);
      if (!member) return;
      const { room, user } = member;
      const point = cleanPoint([payload?.x, payload?.y]);
      if (!point) return;
      const now = Date.now();
      if (now - (user.lastCursorAt ?? 0) < CURSOR_THROTTLE_MS) return;
      user.lastCursorAt = now;
      socket.to(room.id).volatile.emit('board:cursor', { userId: user.id, name: user.name, x: point[0], y: point[1] });
    });
  });
}