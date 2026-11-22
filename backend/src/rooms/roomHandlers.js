import { normalizeRoomId } from './roomStore.js';
import { fail } from '../util/ack.js';

const NAME_MAX = 30;

export function registerRoomHandlers(io, store) {
  io.on('connection', (socket) => {
    // The client sends this on every connect, including reconnects.
    socket.on('room:join', (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const roomId = normalizeRoomId(payload?.roomId);
      const name = typeof payload?.name === 'string' ? payload.name.trim().slice(0, NAME_MAX) : '';
      const clientId = payload?.clientId;

      if (!roomId) return fail(reply, 'BAD_ROOM', 'Invalid room code');
      if (!name) return fail(reply, 'BAD_NAME', 'Please enter a name');
      if (typeof clientId !== 'string' || clientId.length < 16 || clientId.length > 64) {
        return fail(reply, 'BAD_CLIENT', 'Invalid client id');
      }

      const previous = store.roomOfSocket(socket.id);
      if (previous && previous !== roomId) {
        socket.leave(previous);
        store.leaveNow(socket.id);
      }

      const result = store.join({ roomId, clientId, name, socketId: socket.id });
      if (!result) return fail(reply, 'ROOM_NOT_FOUND', 'That room does not exist');

      const { room, user, rejoined } = result;
      socket.join(roomId);
      reply({ ok: true, rejoined, snapshot: store.snapshot(room, user) });

      if (!rejoined) socket.to(roomId).emit('room:user-joined', { name: user.name });
      io.to(roomId).emit('room:users', store.publicUsers(room));
    });

    socket.on('room:leave', (_payload, ack) => {
      const roomId = store.roomOfSocket(socket.id);
      if (roomId) {
        socket.leave(roomId);
        store.leaveNow(socket.id);
      }
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('disconnect', () => {
      const room = store.leave(socket.id);
      if (room) io.to(room.id).emit('room:users', store.publicUsers(room));
    });
  });
}