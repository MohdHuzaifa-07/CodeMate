import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTestServer, sleep, clientId } from '../testkit/helpers.js';

const env = useTestServer();
const { socket, join, createRoom } = env;

test('creates a room with a readable 6-character code', async () => {
  const { roomId } = await createRoom();
  assert.match(roomId, /^[A-Z2-9]{6}$/);
  const res = await (await fetch(`${env.base}/api/rooms/${roomId}`)).json();
  assert.equal(res.exists, true);
  const missing = await (await fetch(`${env.base}/api/rooms/ZZZZZZ`)).json();
  assert.equal(missing.exists, false);
});

test('first user is host, second is not, both see each other', async () => {
  const { roomId } = await createRoom();
  const a = await join(socket(), { roomId, name: 'Mariyam', clientId: clientId() });
  const b = await join(socket(), { roomId: roomId.toLowerCase(), name: 'Hamza', clientId: clientId() });
  assert.equal(a.ok, true);
  assert.equal(a.snapshot.you.isHost, true);
  assert.equal(b.snapshot.you.isHost, false);
  assert.equal(b.snapshot.users.length, 2);
  assert.ok(!JSON.stringify(b.snapshot).includes('clientId'), 'secret client id must never be exposed');
});

test('joining a room that does not exist returns an error', async () => {
  const res = await join(socket(), { roomId: 'ZZZZZZ', name: 'Mariyam', clientId: clientId() });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'ROOM_NOT_FOUND');
});

test('rejects empty names and bad client ids', async () => {
  const { roomId } = await createRoom();
  const noName = await join(socket(), { roomId, name: '   ', clientId: clientId() });
  assert.equal(noName.error.code, 'BAD_NAME');
  const badId = await join(socket(), { roomId, name: 'Mariyam', clientId: 'x' });
  assert.equal(badId.error.code, 'BAD_CLIENT');
});

test('refresh keeps the same seat and role (no duplicate user)', async () => {
  const { roomId } = await createRoom();
  const id = clientId();
  const first = socket();
  const a = await join(first, { roomId, name: 'Mariyam', clientId: id });
  first.disconnect();
  const b = await join(socket(), { roomId, name: 'Mariyam', clientId: id });
  assert.equal(b.rejoined, true);
  assert.equal(b.snapshot.you.id, a.snapshot.you.id);
  assert.equal(b.snapshot.you.isHost, true);
  assert.equal(b.snapshot.users.length, 1);
});

test('host role passes on when the host leaves for good', async () => {
  const { roomId } = await createRoom();
  const host = socket();
  await join(host, { roomId, name: 'Mariyam', clientId: clientId() });
  const member = socket();
  let latest;
  member.on('room:users', (users) => (latest = users));
  await join(member, { roomId, name: 'Hamza', clientId: clientId() });

  host.disconnect();
  await sleep(500); // longer than userGraceMs
  assert.equal(latest.length, 1);
  assert.equal(latest[0].name, 'Hamza');
  assert.equal(latest[0].isHost, true);
});