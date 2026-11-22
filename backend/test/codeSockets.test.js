import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { useTestServer, waitFor, sleep } from '../testkit/helpers.js';
import { RunnerError } from '../src/code/runner.js';

// The fake runner records what it was asked to run and does whatever `behavior` says.
const calls = [];
let behavior;
const resetBehavior = () => {
  behavior = async () => ({ output: 'hello', cpuTime: '0.01', memory: '1' });
  calls.length = 0;
};
resetBehavior();
const runner = async (language, source) => {
  calls.push({ language, source });
  return behavior(language, source);
};

const env = useTestServer({ maxCodeChars: 50 }, { runner });
const { createRoom, joined } = env;

const ask = (s, event, payload) => s.timeout(2000).emitWithAck(event, payload);

/** Makes a socket behave like a browser: keeps a Yjs copy of the code in sync with the server. */
function bind(socket, snapshotUpdate) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(snapshotUpdate), 'remote');
  doc.on('update', (update, origin) => {
    if (origin !== 'remote') socket.emit('code:update', { update });
  });
  socket.on('code:update', ({ update }) => Y.applyUpdate(doc, new Uint8Array(update), 'remote'));
  return doc;
}
const textOf = (doc) => doc.getText('code').toString();

async function twoEditors() {
  const { roomId } = await createRoom();
  const a = await joined(roomId, 'Mariyam');
  const b = await joined(roomId, 'Hamza');
  const docA = bind(a.s, a.res.snapshot.code.update);
  const docB = bind(b.s, b.res.snapshot.code.update);
  return { roomId, a: a.s, b: b.s, docA, docB };
}
const lateText = async (roomId) => {
  const { res } = await joined(roomId, 'Late');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(res.snapshot.code.update));
  return { doc, text: textOf(doc), code: res.snapshot.code };
};

test('a new room starts with empty JavaScript code', async () => {
  const { roomId } = await createRoom();
  const { res } = await joined(roomId, 'Mariyam');
  assert.equal(res.snapshot.code.language, 'javascript');
  assert.equal(textOf(bind(env.socket(), res.snapshot.code.update)), '');
  assert.equal(res.snapshot.code.lastRun, null);
});

test('two people typing at the same moment both keep their edits', async () => {
  const { roomId, docA, docB } = await twoEditors();
  docA.getText('code').insert(0, 'AAA');
  docB.getText('code').insert(0, 'BBB');
  await sleep(250);

  assert.equal(textOf(docA), textOf(docB));
  assert.equal(textOf(docA).length, 6);
  assert.ok(textOf(docA).includes('AAA') && textOf(docA).includes('BBB'));
  assert.equal((await lateText(roomId)).text, textOf(docA), 'a late joiner sees the same text');
});

test('the language is shared by everyone, and bad ones are refused', async () => {
  const { roomId, a, b } = await twoEditors();
  const forA = waitFor(a, 'code:language');
  const forB = waitFor(b, 'code:language');
  assert.equal((await ask(a, 'code:language', { language: 'python' })).ok, true);
  assert.equal((await forA).language, 'python');
  const seenByB = await forB;
  assert.equal(seenByB.language, 'python');
  assert.equal(seenByB.by.name, 'Mariyam');

  assert.equal((await ask(b, 'code:language', { language: 'ruby' })).error.code, 'BAD_LANGUAGE');
  assert.equal((await lateText(roomId)).code.language, 'python');
});

test('bad updates are refused and the code stays as it was', async () => {
  const { roomId, a, docA } = await twoEditors();
  docA.getText('code').insert(0, 'safe');
  await sleep(150);

  assert.equal((await ask(a, 'code:update', { update: 'text' })).error.code, 'BAD_UPDATE');
  assert.equal((await ask(a, 'code:update', { update: new Uint8Array(70_000) })).error.code, 'UPDATE_TOO_LARGE');
  assert.equal((await ask(env.socket(), 'code:update', { update: new Uint8Array(3) })).error.code, 'NOT_IN_ROOM');
  assert.equal((await lateText(roomId)).text, 'safe');
});

test('cursor info reaches others but not the sender', async () => {
  const { a, b } = await twoEditors();
  let echoed = false;
  a.on('code:awareness', () => (echoed = true));
  const seen = waitFor(b, 'code:awareness');
  a.emit('code:awareness', { update: new Uint8Array([1, 2, 3]) });
  assert.equal((await seen).update.length, 3);
  await sleep(100);
  assert.equal(echoed, false);
});

test('code longer than the limit is trimmed for everyone', async () => {
  const { roomId, docA, docB } = await twoEditors();
  docA.getText('code').insert(0, 'x'.repeat(80));
  await sleep(300);
  assert.equal(textOf(docA).length, 50);
  assert.equal(textOf(docB), textOf(docA));
  assert.equal((await lateText(roomId)).text.length, 50);
});

test('running uses the room\'s own code and the result goes to everyone', async () => {
  resetBehavior();
  const { roomId, a, b, docA } = await twoEditors();
  docA.getText('code').insert(0, 'console.log(1)');
  await sleep(150);

  const startedB = waitFor(b, 'code:run-started');
  const resultA = waitFor(a, 'code:run-result');
  const resultB = waitFor(b, 'code:run-result');
  const ack = await ask(a, 'code:run');
  assert.equal(ack.ok, true);

  assert.equal((await startedB).id, ack.id);
  const [ra, rb] = await Promise.all([resultA, resultB]);
  assert.equal(ra.id, ack.id);
  assert.equal(rb.output, 'hello');
  assert.equal(rb.error, null);
  assert.equal(rb.by.name, 'Mariyam');
  assert.deepEqual(calls, [{ language: 'javascript', source: 'console.log(1)' }]);
  assert.equal((await lateText(roomId)).code.lastRun.id, ack.id);
});

test('cannot run empty code or from outside the room', async () => {
  resetBehavior();
  const { a } = await twoEditors();
  assert.equal((await ask(a, 'code:run')).error.code, 'EMPTY_CODE');
  assert.equal((await ask(env.socket(), 'code:run')).error.code, 'NOT_IN_ROOM');
  assert.equal(calls.length, 0);
});

test('only one run at a time per room', async () => {
  resetBehavior();
  let release;
  const gate = new Promise((r) => (release = r));
  behavior = async () => (await gate, { output: 'late', cpuTime: null, memory: null });

  const { a, b, docA } = await twoEditors();
  docA.getText('code').insert(0, 'print(1)');
  await sleep(150);

  const done = waitFor(b, 'code:run-result', 3000);
  assert.equal((await ask(a, 'code:run')).ok, true);
  assert.equal((await ask(b, 'code:run')).error.code, 'RUN_IN_PROGRESS');
  release();
  assert.equal((await done).output, 'late');
  assert.equal((await ask(b, 'code:run')).ok, true, 'allowed again once the first run finished');
});

test('a room can only run a few times per minute', async () => {
  resetBehavior();
  const { a, docA } = await twoEditors();
  docA.getText('code').insert(0, 'print(1)');
  await sleep(150);

  for (let i = 0; i < 5; i++) {
    const done = waitFor(a, 'code:run-result');
    assert.equal((await ask(a, 'code:run')).ok, true);
    await done;
  }
  assert.equal((await ask(a, 'code:run')).error.code, 'RUN_RATE_LIMITED');
});

test('problems with the runner are shown to the room instead of crashing', async () => {
  resetBehavior();
  const { a, b, docA } = await twoEditors();
  docA.getText('code').insert(0, 'while(true){}');
  await sleep(150);

  behavior = async () => {
    throw new RunnerError('TIMEOUT', 'The code took too long to run');
  };
  const slow = waitFor(b, 'code:run-result');
  await ask(a, 'code:run');
  const r1 = await slow;
  assert.equal(r1.error, 'The code took too long to run');
  assert.equal(r1.output, '');

  behavior = async () => {
    throw new Error('secret internal detail');
  };
  const broken = waitFor(b, 'code:run-result');
  const originalError = console.error;
  console.error = () => {};
  try {
    await ask(a, 'code:run');
    const r2 = await broken;
    assert.equal(r2.error, 'Code execution failed', 'internal details are never leaked');
  } finally {
    console.error = originalError;
  }
});