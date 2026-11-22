import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestServer, waitFor, sleep } from '../testkit/helpers.js';

const env = useTestServer({ maxChatMessages: 3 });
const { createRoom, joined, send } = env;

test('a message reaches everyone in the room, including the sender', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  const { s: b } = await joined(roomId, 'Hamza');
  const gotA = waitFor(a, 'chat:message');
  const gotB = waitFor(b, 'chat:message');

  const res = await send(a, '  hello team  ');
  assert.equal(res.ok, true);
  const [ma, mb] = await Promise.all([gotA, gotB]);
  assert.equal(ma.id, mb.id);
  assert.equal(mb.text, 'hello team');
  assert.equal(mb.name, 'Mariyam');
  assert.ok(mb.ts > 0 && mb.userId);
});

test('messages do not leak into other rooms', async () => {
  const { roomId: r1 } = await createRoom();
  const { roomId: r2 } = await createRoom();
  const { s: a } = await joined(r1, 'Mariyam');
  const { s: outsider } = await joined(r2, 'Zed');
  let leaked = false;
  outsider.on('chat:message', () => (leaked = true));
  await send(a, 'private');
  await sleep(200);
  assert.equal(leaked, false);
});

test('a late joiner gets the history in the join snapshot', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  await send(a, 'one');
  await send(a, 'two');
  const { res } = await joined(roomId, 'Late');
  assert.deepEqual(res.snapshot.chat.map((m) => m.text), ['one', 'two']);
});

test('history is capped and the oldest messages drop first', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  for (const t of ['1', '2', '3', '4']) await send(a, t);
  const { res } = await joined(roomId, 'Late');
  assert.deepEqual(res.snapshot.chat.map((m) => m.text), ['2', '3', '4']);
});

test('rejects empty, too-long and out-of-room messages', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  assert.equal((await send(a, '   ')).error.code, 'EMPTY');
  assert.equal((await send(a, 'x'.repeat(1001))).error.code, 'TOO_LONG');
  const stranger = env.socket();
  assert.equal((await send(stranger, 'hi')).error.code, 'NOT_IN_ROOM');
});

test('floods are rate limited', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Spammer');
  const results = [];
  for (let i = 0; i < 7; i++) results.push(await send(a, `m${i}`));
  assert.equal(results.filter((r) => r.ok).length, 5);
  assert.equal(results[6].error.code, 'RATE_LIMITED');
});

test('typing is shown to others but not to the typist', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  const { s: b } = await joined(roomId, 'Hamza');
  let self = false;
  a.on('chat:typing', () => (self = true));
  const seen = waitFor(b, 'chat:typing');
  a.emit('chat:typing');
  assert.equal((await seen).name, 'Mariyam');
  await sleep(100);
  assert.equal(self, false);
});