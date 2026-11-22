import { fail } from '../util/ack.js';

const TEXT_MAX = 1000;
const RATE_LIMIT = 5; // messages...
const RATE_WINDOW_MS = 3000; // ...per 3 seconds, per user
const TYPING_THROTTLE_MS = 1000;

export function registerChatHandlers(io, store) {
  io.on('connection', (socket) => {
    socket.on('chat:send', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');

      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
      if (!text) return fail(reply, 'EMPTY', 'Message is empty');
      if (text.length > TEXT_MAX) return fail(reply, 'TOO_LONG', `Max ${TEXT_MAX} characters`);

      const { room, user } = member;
      const now = Date.now();
      user.chatTimes = (user.chatTimes ?? []).filter((t) => now - t < RATE_WINDOW_MS);
      if (user.chatTimes.length >= RATE_LIMIT) return fail(reply, 'RATE_LIMITED', 'Slow down a little');
      user.chatTimes.push(now);

      // The server is the single source of truth: everyone, including the sender,
      // gets the message from this one event.
      const message = store.addMessage(room, user, text);
      io.to(room.id).emit('chat:message', message);
      reply({ ok: true, message });
    });

    socket.on('chat:typing', () => {
      const member = store.memberOf(socket.id);
      if (!member) return;
      const { room, user } = member;
      const now = Date.now();
      if (now - (user.lastTypingAt ?? 0) < TYPING_THROTTLE_MS) return;
      user.lastTypingAt = now;
      socket.to(room.id).emit('chat:typing', { userId: user.id, name: user.name });
    });
  });
}