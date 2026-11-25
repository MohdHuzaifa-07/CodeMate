import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJdoodleRunner, RunnerError } from '../src/code/runner.js';

const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const creds = { clientId: 'id', clientSecret: 'secret' };

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => err instanceof RunnerError && err.code === code);
}

test('sends the mapped language and returns the output', async () => {
  let sent;
  const run = createJdoodleRunner({
    ...creds,
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return reply(200, { output: 'hi\n', statusCode: 200, memory: '1000', cpuTime: '0.01' });
    },
  });
  const out = await run('python', 'print("hi")');
  assert.deepEqual(out, { output: 'hi\n', cpuTime: '0.01', memory: '1000' });
  assert.equal(sent.url, 'https://api.jdoodle.com/v1/execute');
  assert.deepEqual(sent.body, {
    clientId: 'id',
    clientSecret: 'secret',
    script: 'print("hi")',
    language: 'python3',
    versionIndex: '4',
  });
});

test('program input is sent as stdin, and left out when there is none', async () => {
  const bodies = [];
  const run = createJdoodleRunner({
    ...creds,
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return reply(200, { output: 'ok' });
    },
  });
  await run('c', 'int main(){}', '10\n5\n+\n');
  await run('c', 'int main(){}', '');
  await run('c', 'int main(){}');
  assert.equal(bodies[0].stdin, '10\n5\n+\n');
  assert.ok(!('stdin' in bodies[1]), 'empty input is not sent');
  assert.ok(!('stdin' in bodies[2]), 'no input is not sent');
});

test('long output is cut', async () => {
  const run = createJdoodleRunner({ ...creds, fetchImpl: async () => reply(200, { output: 'x'.repeat(50_000) }) });
  assert.equal((await run('c', 'int main(){}')).output.length, 20_000);
});

test('refuses unknown languages and missing keys without calling the service', async () => {
  let calls = 0;
  const fetchImpl = async () => (calls++, reply(200, { output: '' }));
  await rejectsWith(createJdoodleRunner({ ...creds, fetchImpl })('ruby', 'x'), 'BAD_LANGUAGE');
  await rejectsWith(createJdoodleRunner({ fetchImpl })('python', 'x'), 'NOT_CONFIGURED');
  assert.equal(calls, 0);
});

test('turns service problems into clear errors', async () => {
  const runWith = (fetchImpl) => createJdoodleRunner({ ...creds, fetchImpl })('python', 'x');
  await rejectsWith(runWith(async () => reply(401, { error: 'Unauthorized' })), 'NOT_CONFIGURED');
  await rejectsWith(runWith(async () => reply(429, { error: 'Daily limit reached' })), 'DAILY_LIMIT');
  await rejectsWith(runWith(async () => reply(500, {})), 'RUNNER_FAILED');
  await rejectsWith(runWith(async () => reply(200, { nope: true })), 'RUNNER_FAILED');
  await rejectsWith(runWith(async () => { throw new Error('offline'); }), 'UNAVAILABLE');
});

test('gives up when the service is too slow', async () => {
  const fetchImpl = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  await rejectsWith(createJdoodleRunner({ ...creds, timeoutMs: 30, fetchImpl })('python', 'x'), 'TIMEOUT');
});

test('has its own daily budget that resets the next day', async () => {
  let calls = 0;
  let today = new Date('2026-10-04T10:00:00Z');
  const run = createJdoodleRunner({
    ...creds,
    maxRunsPerDay: 2,
    now: () => today,
    fetchImpl: async () => (calls++, reply(200, { output: 'ok' })),
  });
  await run('python', 'x');
  await run('python', 'x');
  await rejectsWith(run('python', 'x'), 'DAILY_LIMIT');
  assert.equal(calls, 2, 'the third run never reached the service');

  today = new Date('2026-10-05T00:00:01Z');
  assert.equal((await run('python', 'x')).output, 'ok');
});