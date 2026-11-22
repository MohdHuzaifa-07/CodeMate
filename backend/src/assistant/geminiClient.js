export class AssistantError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AssistantError';
    this.code = code;
  }
}

// Google's Gemini API ("Interactions" endpoint). The key goes in a header, never in the address.
export const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Gemini gets one text input. Earlier questions and answers are written in front of the
 * new question, so follow-ups work without any extra conversation format.
 */
function toInput(messages) {
  const last = messages.at(-1);
  const earlier = messages.slice(0, -1);
  if (!earlier.length) return last.content;
  const transcript = earlier.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`).join('\n\n');
  return `Earlier in this conversation (for context only):\n${transcript}\n\n---\n\n${last.content}`;
}

/** The answer text, wherever this version of the API puts it. */
function extractText(body) {
  const fromSteps = (Array.isArray(body?.steps) ? body.steps : [])
    .filter((step) => step?.type === 'model_output')
    .flatMap((step) => (Array.isArray(step.content) ? step.content : []))
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (fromSteps.trim()) return fromSteps;
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text;
  return (Array.isArray(body?.outputs) ? body.outputs : [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns complete({ system, messages }) -> the answer text. It throws AssistantError with a
 * message that is safe to show to users (never the key, never Google's raw reply).
 */
export function createGeminiClient({
  apiKey,
  model = DEFAULT_MODEL,
  maxTokens = 2000, // thinking tokens count too, so leave room
  thinkingLevel = 'low', // the one level every Gemini model accepts
  timeoutMs = 30_000,
  retryDelayMs = 1000,
  fetchImpl = fetch,
} = {}) {
  async function callOnce({ system, messages }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          model,
          input: toInput(messages),
          system_instruction: system,
          generation_config: { thinking_level: thinkingLevel, max_output_tokens: maxTokens },
          store: false, // we keep the conversation ourselves; nothing needs to be saved at Google
        }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      return { res, body };
    } catch (err) {
      if (err?.name === 'AbortError') throw new AssistantError('TIMEOUT', 'The assistant took too long to answer. Try again.');
      throw new AssistantError('UNAVAILABLE', 'Could not reach the assistant service. Try again later.');
    } finally {
      clearTimeout(timer);
    }
  }

  return async function complete({ system, messages }) {
    if (!apiKey) throw new AssistantError('NOT_CONFIGURED', 'The assistant is not set up on this server');

    let { res, body } = await callOnce({ system, messages });
    if (res.status === 503) {
      // Google says this means "temporarily out of capacity": one more try after a short wait
      await sleep(retryDelayMs);
      ({ res, body } = await callOnce({ system, messages }));
    }

    if (!res.ok) {
      const info = body?.error ?? {};
      const message = String(info.message ?? '');
      // Details go to the server log only (never the key or the question)
      console.error('Assistant API error:', res.status, info.status, message.slice(0, 200));
      if (res.status === 400 && info.status === 'FAILED_PRECONDITION') {
        throw new AssistantError(
          'NOT_AVAILABLE',
          "Google's free tier is not available for this key. The host can enable billing in Google AI Studio or use another Google account.",
        );
      }
      if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(message))) {
        throw new AssistantError('BAD_KEY', 'The assistant key on this server was rejected. Ask the host to check it.');
      }
      if (res.status === 429) {
        throw new AssistantError('LIMIT_REACHED', 'The free assistant limit is used up for now. Try again in a minute, or tomorrow.');
      }
      if (res.status === 503) throw new AssistantError('BUSY', 'The assistant service is busy right now. Try again in a moment.');
      if (res.status === 504) throw new AssistantError('TIMEOUT', 'The assistant took too long to answer. Try again.');
      if (res.status >= 500) throw new AssistantError('UNAVAILABLE', 'The assistant service had a problem. Try again later.');
      throw new AssistantError('SERVICE_ERROR', 'The assistant could not handle this request.');
    }

    if (body?.status === 'failed') throw new AssistantError('UNAVAILABLE', 'The assistant service had a problem. Try again later.');
    const text = extractText(body);
    if (!text.trim()) {
      throw new AssistantError(
        'EMPTY',
        body?.status === 'incomplete'
          ? 'The assistant ran out of room before it could answer. Try a shorter question.'
          : 'The assistant had no answer. Try rephrasing your question.',
      );
    }
    return body?.status === 'incomplete' ? `${text}\n\n(The answer was cut short. Ask a narrower question for more detail.)` : text;
  };
}