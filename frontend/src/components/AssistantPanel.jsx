import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket.js';
import { useRoom } from '../context/RoomContext.jsx';
import { splitAnswer } from '../lib/answerFormat.js';

const QUESTION_MAX = 500;
const ASK_TIMEOUT_MS = 60_000; // an answer can take a few seconds
const STARTERS = ['Summarise the chat so far', 'Why did the last run fail?', 'Explain the code', 'What did we decide?'];

export default function AssistantPanel() {
  const { initial } = useRoom();
  const [enabled, setEnabled] = useState(null); // null = still checking
  const [turns, setTurns] = useState([]); // { id, question, answer, sources, error, pending }
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const listRef = useRef(null);
  const nextId = useRef(1);

  // Is the assistant set up on the server? (checked again after a reconnect)
  useEffect(() => {
    let cancelled = false;
    socket.timeout(5000).emit('assistant:status', {}, (err, res) => {
      if (cancelled) return;
      setEnabled(err || !res?.ok ? true : res.enabled); // if unsure, let the server answer when asked
    });
    return () => {
      cancelled = true;
    };
  }, [initial]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const ask = (question) => {
    const q = question.trim();
    if (!q || pending || enabled === false) return;
    const id = nextId.current++;
    // The last few finished turns, so follow-up questions make sense
    const history = turns.filter((t) => t.answer).slice(-3).map((t) => ({ q: t.question, a: t.answer }));
    setTurns((list) => [...list, { id, question: q, pending: true }]);
    setText('');
    setPending(true);

    socket.timeout(ASK_TIMEOUT_MS).emit('assistant:ask', { question: q, history }, (err, res) => {
      setPending(false);
      const finish = (patch) => setTurns((list) => list.map((t) => (t.id === id ? { ...t, pending: false, ...patch } : t)));
      if (err) return finish({ error: 'The assistant did not answer in time. Try again.' });
      if (!res.ok) return finish({ error: res.error.message });
      finish({ answer: res.answer, sources: res.sources });
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    ask(text);
  };

  return (
    <section className="assistant-panel fill d-flex flex-column border rounded" aria-label="Assistant">
      <div className="d-flex align-items-center px-3 pt-3 mb-2">
        <h2 className="h6 text-uppercase text-body-secondary mb-0">Assistant</h2>
        {turns.length > 0 && (
          <button type="button" className="btn btn-link btn-sm ms-auto p-0" onClick={() => setTurns([])} disabled={pending}>
            Clear conversation
          </button>
        )}
      </div>

      <div ref={listRef} className="fill overflow-auto px-3" role="log" aria-live="polite">
        {enabled === false && (
          <div className="alert alert-secondary small" role="status">
            The assistant is not set up on this server. The host needs to add a free Gemini API key (
            <code>GEMINI_API_KEY</code>) to <code>backend/.env</code>.
          </div>
        )}

        {enabled !== false && turns.length === 0 && (
          <div className="small text-body-secondary">
            <p>
              Ask about your code, an error, or what was said in the chat. Only you see the answers. It cannot see the
              whiteboard drawing.
            </p>
            <div className="d-flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" className="btn btn-outline-secondary btn-sm" onClick={() => ask(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className="mb-3">
            <div className="d-flex justify-content-end mb-1">
              <div className="px-3 py-2 rounded-3 bg-primary text-white text-break" style={{ maxWidth: '90%' }}>
                {t.question}
              </div>
            </div>

            {t.pending && (
              <div className="d-flex align-items-center gap-2 small text-body-secondary">
                <div className="spinner-border spinner-border-sm" aria-hidden="true" />
                <span role="status">Thinking…</span>
              </div>
            )}

            {t.error && (
              <div className="alert alert-warning py-2 small mb-0" role="alert">
                {t.error}
              </div>
            )}

            {t.answer && (
              <>
                <div className="bg-body-secondary rounded-3 px-3 py-2">
                  {splitAnswer(t.answer).map((part, i) =>
                    part.type === 'code' ? (
                      <pre key={i} className="assistant-code">
                        <code>{part.text}</code>
                      </pre>
                    ) : (
                      <div key={i} className="assistant-text">
                        {part.text.trim()}
                      </div>
                    ),
                  )}
                </div>
                {t.sources?.length > 0 && (
                  <div className="small text-body-secondary mt-1">
                    Based on: {t.sources.map((s) => `${s.id} ${s.label}`).join(' · ')}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <form className="d-flex gap-2 p-3 pt-2" onSubmit={handleSubmit}>
        <input
          className="form-control"
          aria-label="Your question"
          placeholder={enabled === false ? 'Assistant is not set up' : 'Ask the assistant…'}
          value={text}
          maxLength={QUESTION_MAX}
          autoComplete="off"
          disabled={enabled === false}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || enabled === false || !text.trim()}>
          Ask
        </button>
      </form>
      <p className="small text-body-secondary px-3 pb-3 mb-0">
        Answers come from Google Gemini. keep private information out of the room.
      </p>
    </section>
  );
}