import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { CodeSession } from '../src/code/codeSession.js';

/** Pretends to be a browser: copies the session, edits it, returns the change as an update. */
function clientEdit(session, edit) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, session.snapshot().update);
  const before = Y.encodeStateVector(doc);
  edit(doc.getText('code'));
  return Y.encodeStateAsUpdate(doc, before);
}

test('a new session is empty and uses JavaScript', () => {
  const s = new CodeSession();
  assert.equal(s.text, '');
  assert.equal(s.language, 'javascript');
});

test('applies a change from a client', () => {
  const s = new CodeSession();
  const res = s.applyUpdate(clientEdit(s, (t) => t.insert(0, 'print(1)')));
  assert.equal(res.ok, true);
  assert.equal(s.text, 'print(1)');
});

test('works with Node Buffers and ArrayBuffers too (what Socket.IO delivers)', () => {
  const s = new CodeSession();
  const bytes = clientEdit(s, (t) => t.insert(0, 'ab'));
  assert.equal(s.applyUpdate(Buffer.from(bytes)).ok, true);
  const s2 = new CodeSession();
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(s2.applyUpdate(ab).ok, true);
  assert.equal(s2.text, 'ab');
});

test('rejects non-binary, garbage and oversized updates without changing the text', () => {
  const s = new CodeSession();
  s.applyUpdate(clientEdit(s, (t) => t.insert(0, 'keep')));
  assert.equal(s.applyUpdate('hello').code, 'BAD_UPDATE');
  assert.equal(s.applyUpdate(null).code, 'BAD_UPDATE');
  assert.equal(s.applyUpdate(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255, 255])).code, 'BAD_UPDATE');
  assert.equal(s.applyUpdate(new Uint8Array(70 * 1024)).code, 'UPDATE_TOO_LARGE');
  assert.equal(s.text, 'keep');
});

test('a file that gets too long is trimmed, and the trim reaches every client', () => {
  const s = new CodeSession({ maxChars: 10 });
  const update = clientEdit(s, (t) => t.insert(0, '0123456789ABCDEF'));
  const res = s.applyUpdate(update);
  assert.equal(res.ok, true);
  assert.equal(s.text, '0123456789');
  assert.ok(res.fix, 'a fix update is returned');

  const client = new Y.Doc();
  Y.applyUpdate(client, update);
  Y.applyUpdate(client, res.fix);
  assert.equal(client.getText('code').toString(), '0123456789');
});

test('only supported languages can be chosen', () => {
  const s = new CodeSession();
  assert.equal(s.setLanguage('python').ok, true);
  assert.equal(s.language, 'python');
  assert.equal(s.setLanguage('ruby').code, 'BAD_LANGUAGE');
  assert.equal(s.setLanguage('constructor').code, 'BAD_LANGUAGE');
  assert.equal(s.language, 'python');
});

test('only one run at a time, and runs are limited per minute', () => {
  const s = new CodeSession();
  assert.equal(s.checkRunAllowed({ now: 0, perMinute: 2 }).ok, true);
  s.startRun('r1', 0);
  assert.equal(s.checkRunAllowed({ now: 1, perMinute: 2 }).code, 'RUN_IN_PROGRESS');
  s.finishRun({ id: 'r1' });
  assert.equal(s.lastRun.id, 'r1');

  assert.equal(s.checkRunAllowed({ now: 2, perMinute: 2 }).ok, true);
  s.startRun('r2', 2);
  s.finishRun({ id: 'r2' });
  assert.equal(s.checkRunAllowed({ now: 3, perMinute: 2 }).code, 'RUN_RATE_LIMITED');
  assert.equal(s.checkRunAllowed({ now: 61_000, perMinute: 2 }).ok, true, 'the window moves on');
});