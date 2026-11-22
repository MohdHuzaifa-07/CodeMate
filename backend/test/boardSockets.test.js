import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestServer, waitFor, sleep } from '../testkit/helpers.js';

const env = useTestServer();
const { createRoom, joined } = env;

const newStroke = (over = {}) => ({
  id: crypto.randomUUID(),
  type: 'pencil',
  color: '#112233',
  size: 3,
  point: [10, 20],
  ...over,
});
const ask = (s, event, payload) => s.timeout(2000).emitWithAck(event, payload);
const lateSnapshot = async (roomId) => (await joined(roomId, 'Late')).res.snapshot.board;

test('strokes appear live for others, and are not echoed back to the artist', async () => {
  const { roomId } = await createRoom();
  const { s: mariyam } = await joined(roomId, 'Mariyam');
  const { s: hamza, res } = await joined(roomId, 'Hamza');
  let echoed = false;
  mariyam.on('board:begin', () => (echoed = true));
  mariyam.on('board:extend', () => (echoed = true));

  const s = newStroke();
  const sawBegin = waitFor(hamza, 'board:begin');
  assert.equal((await ask(mariyam, 'board:begin', s)).ok, true);
  const el = await sawBegin;
  assert.equal(el.id, s.id);
  assert.equal(el.ownerId, res.snapshot.users.find((u) => u.name === 'Mariyam').id);

  const sawExtend = waitFor(hamza, 'board:extend');
  mariyam.emit('board:extend', { id: s.id, points: [[30, 40], [50, 60]] });
  assert.deepEqual(await sawExtend, { id: s.id, points: [[30, 40], [50, 60]] });
  await sleep(100);
  assert.equal(echoed, false);
});

test('two people can draw at the same time and a late joiner gets everything', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  const { s: b } = await joined(roomId, 'Hamza');
  const s1 = newStroke();
  const s2 = newStroke({ type: 'rectangle', point: [100, 100] });
  await Promise.all([ask(a, 'board:begin', s1), ask(b, 'board:begin', s2)]);
  a.emit('board:extend', { id: s1.id, points: [[11, 21]] });
  b.emit('board:extend', { id: s2.id, points: [[300, 300]] });
  await sleep(150);

  const board = await lateSnapshot(roomId);
  assert.equal(board.width, 1600);
  assert.equal(board.elements.length, 2);
  const rect = board.elements.find((e) => e.id === s2.id);
  assert.deepEqual(rect.points, [[100, 100], [300, 300]]);
});

test("someone else cannot change your stroke", async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  const { s: b } = await joined(roomId, 'Hamza');
  const s = newStroke();
  await ask(a, 'board:begin', s);
  let seen = false;
  a.on('board:extend', () => (seen = true));
  b.emit('board:extend', { id: s.id, points: [[999, 500]] });
  await sleep(150);
  assert.equal(seen, false);
  assert.equal((await lateSnapshot(roomId)).elements[0].points.length, 1);
});

test('invalid strokes are rejected with an error', async () => {
  const { roomId } = await createRoom();
  const { s } = await joined(roomId, 'Mariyam');
  assert.equal((await ask(s, 'board:begin', newStroke({ type: 'laser' }))).error.code, 'BAD_TYPE');
  assert.equal((await ask(s, 'board:begin', newStroke({ point: [5000, 5] }))).error.code, 'BAD_POINT');
  const stranger = env.socket();
  assert.equal((await ask(stranger, 'board:begin', newStroke())).error.code, 'NOT_IN_ROOM');
  assert.equal((await lateSnapshot(roomId)).elements.length, 0);
});

test('undo and redo only affect your own strokes, and everyone sees the change', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  const { s: b } = await joined(roomId, 'Hamza');
  const mine = newStroke();
  const theirs = newStroke();
  await ask(a, 'board:begin', mine);
  await ask(b, 'board:begin', theirs);

  const removedForA = waitFor(a, 'board:remove');
  const removedForB = waitFor(b, 'board:remove');
  assert.equal((await ask(a, 'board:undo')).id, mine.id);
  assert.equal((await removedForA).id, mine.id);
  assert.equal((await removedForB).id, mine.id);
  assert.deepEqual((await lateSnapshot(roomId)).elements.map((e) => e.id), [theirs.id]);

  assert.equal((await ask(a, 'board:undo')).error.code, 'NOTHING_TO_UNDO');

  const added = waitFor(b, 'board:add');
  assert.equal((await ask(a, 'board:redo')).ok, true);
  assert.equal((await added).id, mine.id);
  assert.equal((await lateSnapshot(roomId)).elements.length, 2);
});

test('only the host can clear the board', async () => {
  const { roomId } = await createRoom();
  const { s: host } = await joined(roomId, 'Mariyam');
  const { s: member } = await joined(roomId, 'Hamza');
  await ask(member, 'board:begin', newStroke());

  assert.equal((await ask(member, 'board:clear')).error.code, 'NOT_HOST');
  assert.equal((await lateSnapshot(roomId)).elements.length, 1);

  const cleared = waitFor(member, 'board:cleared');
  assert.equal((await ask(host, 'board:clear')).ok, true);
  await cleared;
  assert.equal((await lateSnapshot(roomId)).elements.length, 0);
});

test('cursors reach others but not yourself, and bad positions are ignored', async () => {
  const { roomId } = await createRoom();
  const { s: a } = await joined(roomId, 'Mariyam');
  const { s: b } = await joined(roomId, 'Hamza');
  let self = false;
  a.on('board:cursor', () => (self = true));

  const seen = waitFor(b, 'board:cursor');
  a.emit('board:cursor', { x: 400, y: 300 });
  const cursor = await seen;
  assert.equal(cursor.name, 'Mariyam');
  assert.deepEqual([cursor.x, cursor.y], [400, 300]);

  await sleep(80);
  let bad = false;
  b.on('board:cursor', () => (bad = true));
  a.emit('board:cursor', { x: -50, y: 'x' });
  await sleep(150);
  assert.equal(self, false);
  assert.equal(bad, false);
});

test('a flood of board events is rate limited', async () => {
  const { roomId } = await createRoom();
  const { s } = await joined(roomId, 'Spammer');
  const results = await Promise.all(
    Array.from({ length: 170 }, () => ask(s, 'board:begin', newStroke())),
  );
  assert.equal(results.filter((r) => r.ok).length, 150);
  assert.equal(results.at(-1).error.code, 'RATE_LIMITED');
});