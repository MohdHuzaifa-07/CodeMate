import { chatChunks, codeChunks, rank, runChunk } from './retriever.js';
import { buildPrompt } from './prompt.js';

const WHOLE_CODE_CHARS = 6000; // shorter code is sent whole; longer code is searched
const RECENT_MESSAGES = 12;
const RECENT_MAX_CHARS = 3000;
const TOP_CODE_CHUNKS = 3;
const TOP_CHAT_CHUNKS = 3;

/**
 * Chooses what the assistant gets to read from ONE room:
 * the last run, the code (all of it if short, otherwise the best matching parts),
 * the most recent chat, and older chat that matches the question.
 */
export function selectSources({ room, question, budget = 14_000 }) {
  const picked = { code: [], run: [], chat: [] };
  let used = 0;
  const take = (bucket, chunk) => {
    if (used + chunk.text.length > budget) return false;
    picked[bucket].push(chunk);
    used += chunk.text.length;
    return true;
  };

  const run = runChunk(room.code?.lastRun);
  if (run) take('run', run);

  const language = room.code?.language;
  const codeText = room.code?.text ?? '';
  if (codeText.trim()) {
    if (codeText.length <= WHOLE_CODE_CHARS) {
      take('code', { type: 'code', label: 'code', language, text: codeText });
    } else {
      const chunks = codeChunks(codeText);
      const best = rank(chunks, question).filter((r) => r.score > 0).slice(0, TOP_CODE_CHUNKS);
      const chosen = best.length ? best.sort((a, b) => a.index - b.index).map((r) => r.chunk) : chunks.slice(0, 1);
      for (const chunk of chosen) take('code', { ...chunk, language });
    }
  }

  const messages = room.chat ?? [];
  const recentStart = Math.max(0, messages.length - RECENT_MESSAGES);
  const older = chatChunks(messages.slice(0, recentStart));
  const matches = rank(older, question).filter((r) => r.score > 0).slice(0, TOP_CHAT_CHUNKS);
  for (const { chunk } of matches.sort((a, b) => a.index - b.index)) take('chat', chunk);

  let recent = chatChunks(messages.slice(recentStart), { perChunk: RECENT_MESSAGES, maxChars: RECENT_MAX_CHARS, offset: recentStart });
  if (recent.length > 1) recent = recent.slice(-1); // too long for one chunk: keep the newest part
  if (recent[0]) take('chat', { ...recent[0], label: `recent ${recent[0].label}` });

  return [...picked.code, ...picked.run, ...picked.chat].map((chunk, i) => ({ ...chunk, id: `S${i + 1}` }));
}

/**
 * `complete` is the function that talks to Claude (a fake one in tests).
 * ask() only ever sees the room object it is given, so nothing from other rooms can get in.
 */
export function createAssistant({ complete, enabled = true, budgetChars = 14_000, maxAnswerChars = 4000 } = {}) {
  return {
    enabled,
    async ask({ room, asker, question, history = [] }) {
      const sources = selectSources({ room, question, budget: budgetChars });
      const { system, messages } = buildPrompt({ question, sources, history, askerName: asker.name });
      const answer = (await complete({ system, messages })).trim().slice(0, maxAnswerChars);
      return { answer, sources: sources.map(({ id, type, label }) => ({ id, type, label })) };
    },
  };
}