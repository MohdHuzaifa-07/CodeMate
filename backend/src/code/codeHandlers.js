import { randomUUID } from 'node:crypto';
import { fail } from '../util/ack.js';
import { allowEvent } from '../util/rateLimit.js';
import { toBytes } from './codeSession.js';
import { RunnerError } from './runner.js';

const EVENTS_PER_SECOND = 300; // typing + cursor updates, per user
const AWARENESS_MAX_BYTES = 4096;

export function registerCodeHandlers(io, store, { runner, runsPerRoomPerMinute = 5 }) {
  io.on('connection', (socket) => {
    const noop = () => {};
    const replyFn = (ack) => (typeof ack === 'function' ? ack : noop);

    // A change to the shared text (a Yjs update).
    socket.on('code:update', (payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      if (!allowEvent(user, 'code', EVENTS_PER_SECOND)) return fail(reply, 'RATE_LIMITED', 'Slow down a little');

      const result = room.code.applyUpdate(payload?.update);
      if (!result.ok) return fail(reply, result.code, result.message);

      socket.to(room.id).emit('code:update', { update: payload.update });
      // If the file was too long and got trimmed, everyone (including the sender) gets the trim.
      if (result.fix) io.to(room.id).emit('code:update', { update: result.fix });
      reply({ ok: true });
    });

    // Live cursors and selections (Yjs awareness). Just passed along to the others.
    socket.on('code:awareness', (payload) => {
      const member = store.memberOf(socket.id);
      if (!member) return;
      const { room, user } = member;
      if (!allowEvent(user, 'code', EVENTS_PER_SECOND)) return;
      const bytes = toBytes(payload?.update);
      if (!bytes || bytes.byteLength > AWARENESS_MAX_BYTES) return;
      socket.to(room.id).emit('code:awareness', { update: payload.update });
    });

    // The language is shared by the whole room.
    socket.on('code:language', (payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      if (!allowEvent(user, 'code', EVENTS_PER_SECOND)) return fail(reply, 'RATE_LIMITED', 'Slow down a little');

      const result = room.code.setLanguage(payload?.language);
      if (!result.ok) return fail(reply, result.code, result.message);
      io.to(room.id).emit('code:language', {
        language: room.code.language,
        by: { id: user.id, name: user.name },
      });
      reply({ ok: true });
    });

    // Run the room's code. The server uses its own copy of the text, never what the client sends.
    socket.on('code:run', (_payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      const { room, user } = member;
      const session = room.code;

      const source = session.text;
      if (!source.trim()) return fail(reply, 'EMPTY_CODE', 'Write some code first');
      const allowed = session.checkRunAllowed({ perMinute: runsPerRoomPerMinute });
      if (!allowed.ok) return fail(reply, allowed.code, allowed.message);

      const id = randomUUID();
      const language = session.language;
      const by = { id: user.id, name: user.name };
      session.startRun(id);
      io.to(room.id).emit('code:run-started', { id, by, language });
      reply({ ok: true, id });

      runner(language, source)
        .then((out) => ({ output: out.output, error: null, cpuTime: out.cpuTime, memory: out.memory }))
        .catch((err) => {
          if (!(err instanceof RunnerError)) console.error('Unexpected run error:', err);
          return {
            output: '',
            error: err instanceof RunnerError ? err.message : 'Code execution failed',
            cpuTime: null,
            memory: null,
          };
        })
        .then((outcome) => {
          const result = { id, by, language, ts: Date.now(), ...outcome };
          session.finishRun(result);
          io.to(room.id).emit('code:run-result', result);
        });
    });
  });
}