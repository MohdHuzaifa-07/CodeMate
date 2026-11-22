import { LANGUAGES } from './languages.js';

export class RunnerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
  }
}

const JDOODLE_URL = 'https://api.jdoodle.com/v1/execute';
const MAX_OUTPUT_CHARS = 20_000;

/**
 * Returns run(language, source) -> { output, cpuTime, memory }.
 * It throws RunnerError for anything that goes wrong.
 * The rest of the app only knows this one function, so switching provider
 * (Judge0, Piston...) means writing another function like this one.
 */
export function createJdoodleRunner({
  clientId,
  clientSecret,
  timeoutMs = 15_000,
  maxRunsPerDay = 150,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  let day = '';
  let used = 0;

  return async function run(language, source) {
    const lang = LANGUAGES[language];
    if (!lang) throw new RunnerError('BAD_LANGUAGE', 'Unsupported language');
    if (!clientId || !clientSecret) {
      throw new RunnerError('NOT_CONFIGURED', 'Code execution is not set up on this server');
    }

    // Our own daily budget, so one busy day cannot burn the whole JDoodle quota
    const today = now().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= maxRunsPerDay) throw new RunnerError('DAILY_LIMIT', 'Daily run limit reached, try again tomorrow');
    used += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let body = null;
    try {
      res = await fetchImpl(JDOODLE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          clientSecret,
          script: source,
          language: lang.jdoodle.language,
          versionIndex: lang.jdoodle.versionIndex,
        }),
        signal: controller.signal,
      });
      body = await res.json().catch(() => null);
    } catch (err) {
      if (err?.name === 'AbortError') throw new RunnerError('TIMEOUT', 'The code took too long to run');
      throw new RunnerError('UNAVAILABLE', 'Could not reach the code runner');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) throw new RunnerError('DAILY_LIMIT', 'Daily run limit reached, try again tomorrow');
    if (res.status === 401) throw new RunnerError('NOT_CONFIGURED', 'The code runner rejected our credentials');
    if (!res.ok || !body || typeof body.output !== 'string') {
      throw new RunnerError('RUNNER_FAILED', 'The code runner returned an error');
    }
    return {
      output: body.output.slice(0, MAX_OUTPUT_CHARS),
      cpuTime: body.cpuTime ?? null,
      memory: body.memory ?? null,
    };
  };
}