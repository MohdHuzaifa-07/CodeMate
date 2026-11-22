import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, rank, chatChunks, codeChunks, runChunk } from '../src/assistant/retriever.js';

test('tokenize splits camelCase and snake_case, drops filler words and unifies word forms', () => {
  assert.deepEqual(tokenize('getUserName and parse_json'), ['get', 'user', 'name', 'parse', 'json']);
  assert.deepEqual(tokenize('Why did the run fail?'), ['run', 'fail']);
  assert.deepEqual(tokenize('failed fails failing'), ['fail', 'fail', 'fail']);
  assert.deepEqual(tokenize('running stopped'), ['run', 'stop']);
  assert.deepEqual(tokenize('class classes files file'), ['class', 'class', 'file', 'file']);
  assert.deepEqual(tokenize('passed pass called call'), ['pass', 'pass', 'call', 'call']);
  assert.deepEqual(tokenize('  ...  '), []);
});

test('rank puts the matching chunk first and gives unrelated chunks no score', () => {
  const chunks = [{ text: 'The weather is nice' }, { text: 'null pointer error in parser' }, { text: 'lunch plans' }];
  const ranked = rank(chunks, 'why was there a parser error?');
  assert.equal(ranked[0].index, 1);
  assert.ok(ranked[0].score > 0);
  assert.deepEqual(ranked.slice(1).map((r) => [r.index, r.score]), [[0, 0], [2, 0]], 'ties keep their order');
});

test('rank prefers the rarer word over the common one', () => {
  const chunks = [{ text: 'error error error' }, { text: 'error in the parser' }];
  assert.equal(rank(chunks, 'parser error')[0].index, 1);
});

test('rank copes with nothing to rank and with empty questions', () => {
  assert.deepEqual(rank([], 'anything'), []);
  const ranked = rank([{ text: 'a b c' }, { text: 'd e f' }], '   ');
  assert.deepEqual(ranked.map((r) => [r.index, r.score]), [[0, 0], [1, 0]]);
});

test('chat is grouped into chunks with correct message numbers', () => {
  const messages = Array.from({ length: 14 }, (_, i) => ({ name: i % 2 ? 'Hamza' : 'Mariyam', text: `msg ${i + 1}` }));
  const chunks = chatChunks(messages);
  assert.deepEqual(chunks.map((c) => c.label), ['chat messages 1-6', 'chat messages 7-12', 'chat messages 13-14']);
  assert.equal(chunks[0].text.split('\n')[0], 'Mariyam: msg 1');
  assert.deepEqual(chatChunks(messages.slice(0, 7), { offset: 10 }).map((c) => c.label), ['chat messages 11-16', 'chat messages 17-17']);
  assert.deepEqual(chatChunks([]), []);
});

test('very long chat messages are shortened', () => {
  const [chunk] = chatChunks([{ name: 'Mariyam', text: 'x'.repeat(2000) }]);
  assert.ok(chunk.text.length < 450);
  assert.ok(chunk.text.endsWith('…'));
});

test('code is cut into overlapping pieces with line numbers', () => {
  const code = Array.from({ length: 70 }, (_, i) => `line ${i + 1}`).join('\n');
  assert.deepEqual(codeChunks(code).map((c) => c.label), ['code lines 1-30', 'code lines 26-55', 'code lines 51-70']);
  assert.deepEqual(codeChunks('\n\n  \n'), []);
  assert.equal(codeChunks('print(1)').length, 1);
});

test('the last run is described in plain words', () => {
  assert.equal(runChunk(null), null);
  const ok = runChunk({ by: { name: 'Hamza' }, language: 'python', output: 'hi\n', error: null });
  assert.equal(ok.label, 'last run');
  assert.match(ok.text, /Run by Hamza \(python\)\nOutput:\nhi/);
  assert.match(runChunk({ by: { name: 'Hamza' }, language: 'c', output: '', error: 'Daily run limit reached' }).text, /The run failed: Daily run limit/);
  assert.match(runChunk({ by: { name: 'H' }, language: 'c', output: '', error: null }).text, /\(no output\)/);
});