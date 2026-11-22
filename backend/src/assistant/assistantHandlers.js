import { fail } from '../util/ack.js';
import { AssistantError } from './geminiClient.js';

const QUESTION_MAX = 500;
const HISTORY_TURNS = 3;
const WINDOW_MS = 60_000;

function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-20) // never look at more than this, whatever was sent
    .filter((turn) => typeof turn?.q === 'string' && typeof turn?.a === 'string')
    .map((turn) => ({ q: turn.q.trim().slice(0, QUESTION_MAX), a: turn.a.trim().slice(0, 1500) }))
    .filter((turn) => turn.q && turn.a)
    .slice(-HISTORY_TURNS);
}

export function registerAssistantHandlers(io, store, { assistant, asksPerRoomPerMinute = 6, maxAsksPerDay = 300 }) {
  const today = { day: '', used: 0 }; // one counter for the whole server, to protect your budget

  io.on('connection', (socket) => {
    const noop = () => {};
    const replyFn = (ack) => (typeof ack === 'function' ? ack : noop);

    // Lets the panel know whether it can be used at all
    socket.on('assistant:status', (_payload, ack) => replyFn(ack)({ ok: true, enabled: assistant.enabled }));

    // The answer goes only to the person who asked.
    socket.on('assistant:ask', async (payload, ack) => {
      const reply = replyFn(ack);
      const member = store.memberOf(socket.id);
      if (!member) return fail(reply, 'NOT_IN_ROOM', 'Join a room first');
      if (!assistant.enabled) return fail(reply, 'NOT_CONFIGURED', 'The assistant is not set up on this server');

      const question = typeof payload?.question === 'string' ? payload.question.trim() : '';
      if (!question) return fail(reply, 'EMPTY', 'Type a question first');
      if (question.length > QUESTION_MAX) return fail(reply, 'TOO_LONG', `Keep it under ${QUESTION_MAX} characters`);

      const { room, user } = member;
      if (user.asking) return fail(reply, 'ASK_IN_PROGRESS', 'Wait for the current answer first');

      const now = Date.now();
      room.assistantTimes = (room.assistantTimes ?? []).filter((t) => now - t < WINDOW_MS);
      if (room.assistantTimes.length >= asksPerRoomPerMinute) {
        return fail(reply, 'ASK_RATE_LIMITED', 'This room is asking too often. Wait a moment.');
      }
      const day = new Date(now).toISOString().slice(0, 10);
      if (today.day !== day) Object.assign(today, { day, used: 0 });
      if (today.used >= maxAsksPerDay) return fail(reply, 'DAILY_LIMIT', 'The assistant has reached its daily limit. Try tomorrow.');

      room.assistantTimes.push(now);
      today.used += 1;
      user.asking = true;
      try {
        const { answer, sources } = await assistant.ask({ room, asker: user, question, history: cleanHistory(payload?.history) });
        reply({ ok: true, answer, sources });
      } catch (err) {
        if (err instanceof AssistantError) return fail(reply, err.code, err.message);
        console.error('Unexpected assistant error:', err);
        fail(reply, 'ASSISTANT_FAILED', 'The assistant could not answer. Try again.');
      } finally {
        user.asking = false;
      }
    });
  });
}