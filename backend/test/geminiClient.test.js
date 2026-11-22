import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, AssistantError, API_URL } from '../src/assistant/geminiClient.js';

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const answer = (text, extra = {}) =>
  reply(200, { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }], ...extra });
const googleError = (status, code, message) => reply(code, { error: { code, status, message } });
const KEY = 'AIza-test-key-123';
const input = { system: 'be nice', messages: [{ role: 'user', content: 'hi' }] };

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof AssistantError && err.code === code);
}
function quietly(fn) {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => (console.error = original));
}
const client = (fetchImpl, extra = {}) => createGeminiClient({ apiKey: KEY, retryDelayMs: 0, fetchImpl, ...extra });

test('sends the request the way Google documents it, with the key in a header', async () => {
  let sent;
  const complete = client(async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return answer('Hello there');
  });
  assert.equal(await complete(input), 'Hello there');
  assert.equal(sent.url, API_URL);
  assert.ok(!sent.url.includes(KEY), 'the key is never in the address');
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers['x-goog-api-key'], KEY);
  assert.equal(sent.init.headers['content-type'], 'application/json');
  assert.deepEqual(sent.body, {
    model: 'gemini-3.5-flash-lite',
    input: 'hi',
    system_instruction: 'be nice',
    generation_config: { thinking_level: 'low', max_output_tokens: 2000 },
    store: false,
  });
});

test('the model, thinking level and answer length can be changed', async () => {
  let body;
  const complete = client(async (_u, init) => ((body = JSON.parse(init.body)), answer('ok')), {
    model: 'gemini-3.8-flash',
    thinkingLevel: 'medium',
    maxTokens: 500,
  });
  await complete(input);
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.deepEqual(body.generation_config, { thinking_level: 'medium', max_output_tokens: 500 });
});

test('earlier questions and answers are written in front of the new question', async () => {
  let body;
  const complete = client(async (_u, init) => ((body = JSON.parse(init.body)), answer('ok')));
  await complete({
    system: 's',
    messages: [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: '<room_context>…</room_context>\n\nQuestion from Mariyam: and then?' },
    ],
  });
  assert.match(body.input, /^Earlier in this conversation \(for context only\):\nUser: first question\n\nAssistant: first answer\n\n---\n\n<room_context>/);
  assert.match(body.input, /Question from Mariyam: and then\?$/);
});

test('reads the answer from the steps, skipping thoughts, and copes with other shapes', async () => {
  const steps = {
    status: 'completed',
    steps: [
      { type: 'thought', summary: [{ type: 'text', text: 'private thinking' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'Part one. ' }, { type: 'image', data: 'x' }] },
      { type: 'model_output', content: [{ type: 'text', text: 'Part two.' }] },
    ],
  };
  assert.equal(await client(async () => reply(200, steps))(input), 'Part one. Part two.');
  assert.equal(await client(async () => reply(200, { status: 'completed', output_text: 'From text field' }))(input), 'From text field');
  assert.equal(await client(async () => reply(200, { outputs: [{ type: 'text', text: 'Old shape' }] }))(input), 'Old shape');
});

test('an empty or unfinished answer is reported clearly', async () => {
  await rejectsWith(client(async () => reply(200, { status: 'completed', steps: [] }))(input), 'EMPTY');
  await rejectsWith(client(async () => reply(200, {}))(input), 'EMPTY');
  await assert.rejects(
    client(async () => reply(200, { status: 'incomplete', steps: [] }))(input),
    (err) => err.code === 'EMPTY' && /ran out of room/.test(err.message),
  );
  const cut = await client(async () => answer('Partial', { status: 'incomplete' }))(input);
  assert.match(cut, /^Partial\n\n\(The answer was cut short/);
  await rejectsWith(client(async () => reply(200, { status: 'failed' }))(input), 'UNAVAILABLE');
});

test('without a key it refuses and never calls the service', async () => {
  let calls = 0;
  const complete = createGeminiClient({ fetchImpl: async () => (calls++, answer('x')) });
  await rejectsWith(complete(input), 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('turns Google\'s error codes into clear, safe messages', async () => {
  const failing = (status, code, message = 'x') => quietly(() => client(async () => googleError(status, code, message))(input));
  await rejectsWith(failing('INVALID_ARGUMENT', 400, 'API key not valid. Please pass a valid API key.'), 'BAD_KEY');
  await rejectsWith(failing('PERMISSION_DENIED', 403), 'BAD_KEY');
  await rejectsWith(failing('UNAUTHENTICATED', 401), 'BAD_KEY');
  await rejectsWith(failing('FAILED_PRECONDITION', 400, 'Gemini API free tier is not available in your country.'), 'NOT_AVAILABLE');
  await rejectsWith(failing('RESOURCE_EXHAUSTED', 429), 'LIMIT_REACHED');
  await rejectsWith(failing('UNAVAILABLE', 503), 'BUSY');
  await rejectsWith(failing('DEADLINE_EXCEEDED', 504), 'TIMEOUT');
  await rejectsWith(failing('INTERNAL', 500), 'UNAVAILABLE');
  await rejectsWith(failing('NOT_FOUND', 404, 'models/nope is not found'), 'SERVICE_ERROR');
  await rejectsWith(failing('INVALID_ARGUMENT', 400, 'Invalid value at generation_config'), 'SERVICE_ERROR');
});

test('error messages never contain the key or Google\'s own wording', async () => {
  for (const [status, code] of [['PERMISSION_DENIED', 403], ['RESOURCE_EXHAUSTED', 429], ['INTERNAL', 500], ['INVALID_ARGUMENT', 400]]) {
    await assert.rejects(
      quietly(() => client(async () => googleError(status, code, `secret detail ${KEY}`))(input)),
      (err) => !err.message.includes(KEY) && !err.message.includes('secret detail'),
    );
  }
});

test('a busy service gets one more try, and a rate limit does not', async () => {
  let calls = 0;
  const recovers = client(async () => (++calls === 1 ? googleError('UNAVAILABLE', 503, 'busy') : answer('second time')));
  assert.equal(await quietly(() => recovers(input)).catch(() => 'failed'), 'second time');
  assert.equal(calls, 2);

  calls = 0;
  await rejectsWith(quietly(() => client(async () => (calls++, googleError('UNAVAILABLE', 503, 'busy')))(input)), 'BUSY');
  assert.equal(calls, 2, 'tried twice, then gave up');

  calls = 0;
  await rejectsWith(quietly(() => client(async () => (calls++, googleError('RESOURCE_EXHAUSTED', 429, 'limit')))(input)), 'LIMIT_REACHED');
  assert.equal(calls, 1, 'retrying a rate limit would only use up more of the quota');
});

test('gives up when the service is too slow, and copes with network trouble', async () => {
  const slow = (_u, { signal }) =>
    new Promise((_res, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await rejectsWith(client(slow, { timeoutMs: 30 })(input), 'TIMEOUT');
  await rejectsWith(client(async () => { throw new Error('offline'); })(input), 'UNAVAILABLE');
});