import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { io as connect } from 'socket.io-client';
import { buildServer } from '../src/app.js';
import { useTestServer, waitFor, sleep, clientId } from '../testkit/helpers.js';
import { createAssistant } from '../src/assistant/assistant.js';
import { AssistantError } from '../src/assistant/geminiClient.js';

// Only the call to the AI service is fake. Search, prompt, rooms, chat and code are the real thing.
const prompts = [];
let behavior;
const resetBehavior = () => {
  behavior = async () => 'Here is the answer (S1).';
  prompts.length = 0;
};
resetBehavior();
const complete = async (input) => {
  prompts.push(input);
  return behavior(input);
};
const assistant = createAssistant({ complete, enabled: true });
const runner = async () => ({ output: 'IndexError: list index out of range', cpuTime: '0.01', memory: '1' });

const env = useTestServer({ asksPerRoomPerMinute: 3, maxAsksPerDay: 1000 }, { assistant, runner });
const { createRoom, joined, send } = env;

const emit = (s, event, payload) => s.timeout(5000).emitWithAck(event, payload);
const ask = (s, question, history) => emit(s, 'assistant:ask', { question, history });
const lastPrompt = () => prompts.at(-1).messages.at(-1).content;

/** Types text into the room's shared code, like the editor does. */
async function typeCode(sock, snapshot, text) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(snapshot.code.update));
  const before = Y.encodeStateVector(doc);
  doc.getText('code').insert(0, text);
  assert.equal((await emit(sock, 'code:update', { update: Y.encodeStateAsUpdate(doc, before) })).ok, true);
}

test('the assistant reports that it is ready', async () => {
  const { s } = await joined((await createRoom()).roomId, 'Mariyam');
  assert.deepEqual(await emit(s, 'assistant:status'), { ok: true, enabled: true });
});

test('answers from this room\'s chat, code and last run, and only to the asker', async () => {
  resetBehavior();
  const { roomId } = await createRoom();
  const { s: mariyam, res } = await joined(roomId, 'Mariyam');
  const { s: hamza } = await joined(roomId, 'Hamza');
  const heardByHamza = [];
  hamza.onAny((event) => heardByHamza.push(event));

  await send(hamza, 'we should use postgres for storage');
  await emit(mariyam, 'code:language', { language: 'python' });
  await typeCode(mariyam, res.snapshot, 'print(items[5])');
  const finished = waitFor(mariyam, 'code:run-result');
  await emit(mariyam, 'code:run');
  await finished;
  heardByHamza.length = 0;

  const answer = await ask(mariyam, 'why did the last run fail?');
  assert.equal(answer.ok, true);
  assert.equal(answer.answer, 'Here is the answer (S1).');
  assert.deepEqual(answer.sources.map((s) => s.type).sort(), ['chat', 'code', 'run']);
  assert.ok(answer.sources.every((s) => s.id && s.label && !('text' in s)), 'sources carry labels only');

  const content = lastPrompt();
  assert.match(content, /print\(items\[5\]\)/);
  assert.match(content, /IndexError: list index out of range/);
  assert.match(content, /Hamza: we should use postgres for storage/);
  assert.match(content, /Question from Mariyam: why did the last run fail\?/);
  assert.match(prompts.at(-1).system, /CodeMate assistant/);

  await sleep(150);
  assert.deepEqual(heardByHamza.filter((e) => e.startsWith('assistant')), [], 'nobody else is told');
});

test('one room can never see another room\'s content', async () => {
  resetBehavior();
  const a = await joined((await createRoom()).roomId, 'Asha');
  const b = await joined((await createRoom()).roomId, 'Ben');
  await send(a.s, 'the secret-alpha-token is hidden here');
  await send(b.s, 'we talk about lunch in room B');

  assert.equal((await ask(b.s, 'what was said about the secret-alpha-token?')).ok, true);
  assert.ok(!lastPrompt().includes('secret-alpha-token is hidden'), 'room A text must not reach room B');
  assert.match(lastPrompt(), /lunch in room B/);
});

test('checks who is asking and what they asked', async () => {
  resetBehavior();
  assert.equal((await ask(env.socket(), 'hello?')).error.code, 'NOT_IN_ROOM');
  const { s } = await joined((await createRoom()).roomId, 'Mariyam');
  assert.equal((await ask(s, '   ')).error.code, 'EMPTY');
  assert.equal((await ask(s, undefined)).error.code, 'EMPTY');
  assert.equal((await ask(s, 'x'.repeat(501))).error.code, 'TOO_LONG');
  assert.equal(prompts.length, 0, 'bad questions never reach the AI service');
});

test('follow-up questions carry the last few turns, and junk history is dropped', async () => {
  resetBehavior();
  const { s } = await joined((await createRoom()).roomId, 'Mariyam');
  const history = [
    { q: 'one', a: 'a1' },
    { q: 'two', a: 'a2' },
    'junk',
    { q: 'three', a: 'a3' },
    { q: 123, a: 'bad' },
    { q: 'four', a: 'a4' },
    { q: '', a: 'empty question' },
  ];
  assert.equal((await ask(s, 'and why?', history)).ok, true);
  const { messages } = prompts.at(-1);
  // junk is dropped first, then the last three real turns are kept
  assert.deepEqual(messages.slice(0, -1).map((m) => m.content), ['two', 'a2', 'three', 'a3', 'four', 'a4']);
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
  assert.match(messages.at(-1).content, /Question from Mariyam: and why\?/);
  assert.equal((await ask(s, 'no history', 'not an array')).ok, true);
});

test('one question at a time per person', async () => {
  resetBehavior();
  let release;
  const gate = new Promise((r) => (release = r));
  behavior = async () => (await gate, 'late answer');
  const { s } = await joined((await createRoom()).roomId, 'Mariyam');

  const first = ask(s, 'first question');
  await sleep(100);
  assert.equal((await ask(s, 'second question')).error.code, 'ASK_IN_PROGRESS');
  release();
  assert.equal((await first).answer, 'late answer');
  behavior = async () => 'next answer';
  assert.equal((await ask(s, 'third question')).answer, 'next answer', 'free again afterwards');
});

test('a room can only ask a few times per minute, other rooms are not affected', async () => {
  resetBehavior();
  const busy = await joined((await createRoom()).roomId, 'Mariyam');
  const other = await joined((await createRoom()).roomId, 'Hamza');
  for (let i = 0; i < 3; i++) assert.equal((await ask(busy.s, `question ${i}`)).ok, true);
  assert.equal((await ask(busy.s, 'one too many')).error.code, 'ASK_RATE_LIMITED');
  assert.equal((await ask(other.s, 'my first question')).ok, true);
});

test('problems are explained kindly and never leak details', async () => {
  resetBehavior();
  const { s } = await joined((await createRoom()).roomId, 'Mariyam');

  behavior = async () => {
    throw new AssistantError('BUSY', 'The assistant is busy right now. Try again in a moment.');
  };
  const busy = await ask(s, 'q1');
  assert.deepEqual([busy.ok, busy.error.code], [false, 'BUSY']);
  assert.match(busy.error.message, /busy right now/);

  behavior = async () => {
    throw new Error('internal secret detail sk-12345');
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const broken = await ask(s, 'q2');
    assert.equal(broken.error.code, 'ASSISTANT_FAILED');
    assert.ok(!JSON.stringify(broken).includes('secret'));
  } finally {
    console.error = originalError;
  }

  behavior = async () => 'recovered';
  assert.equal((await ask(s, 'q3')).answer, 'recovered', 'a failure does not block the next question');
});

/** A second, separate server, for the settings that cannot change inside one test file. */
async function withServer(config, deps, fn) {
  const ctx = buildServer({ allowedOrigins: ['*'], userGraceMs: 150, emptyRoomTtlMs: 60_000, maxRooms: 20, ...config }, deps);
  await new Promise((resolve) => ctx.httpServer.listen(0, resolve));
  const base = `http://localhost:${ctx.httpServer.address().port}`;
  const sockets = [];
  try {
    const { roomId } = await (await fetch(`${base}/api/rooms`, { method: 'POST' })).json();
    const s = connect(base, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    await emit(s, 'room:join', { roomId, name: 'Mariyam', clientId: clientId() });
    await fn(s);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await ctx.close();
    ctx.httpServer.close();
  }
}

test('there is a daily limit for the whole server', async () => {
  resetBehavior();
  await withServer({ asksPerRoomPerMinute: 99, maxAsksPerDay: 2 }, { assistant, runner }, async (s) => {
    assert.equal((await ask(s, 'one')).ok, true);
    assert.equal((await ask(s, 'two')).ok, true);
    const third = await ask(s, 'three');
    assert.equal(third.error.code, 'DAILY_LIMIT');
    assert.match(third.error.message, /daily limit/);
  });
});

test('when no key is set, it says so instead of failing', async () => {
  resetBehavior();
  const off = createAssistant({ complete, enabled: false });
  await withServer({}, { assistant: off, runner }, async (s) => {
    assert.deepEqual(await emit(s, 'assistant:status'), { ok: true, enabled: false });
    assert.equal((await ask(s, 'hello?')).error.code, 'NOT_CONFIGURED');
  });
  assert.equal(prompts.length, 0);
});

test('with no key in the settings, the real setup is switched off by itself', async () => {
  await withServer({}, { runner }, async (s) => {
    assert.deepEqual(await emit(s, 'assistant:status'), { ok: true, enabled: false });
    assert.equal((await ask(s, 'hello?')).error.code, 'NOT_CONFIGURED');
  });
});