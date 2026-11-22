// Finds the parts of a room (chat, code, last run) that matter for a question.
// It uses keyword ranking (BM25), so it needs no downloads and works offline.
// Anything with the same shape ({ rank(chunks, query) }) can replace it later, for example a smarter search.

const STOP_WORDS = new Set(
  ('a an the is are was were be been to of in on at for and or it its this that these those with what why how did do does ' +
    'we you i me my our can could should would will from by as not no if so there here about has have had they them he she ' +
    'please tell show give')
    .split(' '),
);

/** Light stemming so "failed", "fails" and "failing" all become "fail". */
function stem(word) {
  if (word.length <= 3 || word.endsWith('ss')) return word;
  let w = word;
  if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (/(s|x|z|ch|sh)es$/.test(w) && w.length > 4) w = w.slice(0, -2); // classes -> class
  else if (w.endsWith('s')) w = w.slice(0, -1); // files -> file
  // A doubled consonant left by the cut: runn -> run, stopp -> stop (but pass, call, stuff stay as they are)
  const last = w[w.length - 1];
  if (w !== word && w.length > 3 && last === w[w.length - 2] && !'slfz'.includes(last)) w = w.slice(0, -1);
  return w;
}

/** Words of a text: lower case, split on punctuation, camelCase and snake_case. */
export function tokenize(text) {
  const tokens = [];
  for (const raw of String(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    for (const part of raw.replace(/([a-z\d])([A-Z])/g, '$1 $2').split(' ')) {
      const lower = part.toLowerCase();
      if (lower.length < 2 || STOP_WORDS.has(lower)) continue;
      tokens.push(stem(lower));
    }
  }
  return tokens;
}

/** Ranks chunks for a query with BM25. Highest score first; ties keep their original order. */
export function rank(chunks, query, { k1 = 1.5, b = 0.75 } = {}) {
  const terms = [...new Set(tokenize(query))];
  const docs = chunks.map((c) => tokenize(c.text));
  const N = docs.length;
  const avgLen = N ? docs.reduce((sum, d) => sum + d.length, 0) / N || 1 : 1;

  const df = new Map();
  for (const term of terms) df.set(term, docs.filter((d) => d.includes(term)).length);

  return chunks
    .map((chunk, index) => {
      const doc = docs[index];
      let score = 0;
      for (const term of terms) {
        const tf = doc.reduce((n, t) => (t === term ? n + 1 : n), 0);
        if (!tf) continue;
        const n = df.get(term);
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * doc.length) / avgLen));
      }
      return { chunk, score, index };
    })
    .sort((x, y) => y.score - x.score || x.index - y.index);
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Groups chat messages into small chunks. `offset` keeps the message numbers right. */
export function chatChunks(messages, { perChunk = 6, maxChars = 1500, offset = 0 } = {}) {
  const chunks = [];
  let lines = [];
  let chars = 0;
  let start = 0;
  const flush = (end) => {
    if (!lines.length) return;
    chunks.push({ type: 'chat', label: `chat messages ${offset + start + 1}-${offset + end}`, text: lines.join('\n') });
    lines = [];
    chars = 0;
  };
  messages.forEach((m, i) => {
    const line = `${m.name}: ${clip(m.text, 400)}`;
    if (lines.length && (lines.length >= perChunk || chars + line.length > maxChars)) {
      flush(i);
      start = i;
    }
    lines.push(line);
    chars += line.length + 1;
  });
  flush(messages.length);
  return chunks;
}

/** Cuts code into overlapping pieces of about 30 lines. */
export function codeChunks(text, { linesPerChunk = 30, overlap = 5 } = {}) {
  const lines = text.split('\n');
  const chunks = [];
  for (let start = 0; start < lines.length; start += linesPerChunk - overlap) {
    const end = Math.min(start + linesPerChunk, lines.length);
    const body = lines.slice(start, end).join('\n');
    if (body.trim()) chunks.push({ type: 'code', label: `code lines ${start + 1}-${end}`, text: clip(body, 3000) });
    if (end === lines.length) break;
  }
  return chunks;
}

/** The last time the room ran its code. */
export function runChunk(run) {
  if (!run) return null;
  const header = `Run by ${run.by?.name ?? 'someone'} (${run.language})`;
  const body = run.error ? `The run failed: ${run.error}` : `Output:\n${run.output || '(no output)'}`;
  return { type: 'run', label: 'last run', text: clip(`${header}\n${body}`, 3000) };
}