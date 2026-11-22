import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket.js';
import { useRoom } from '../context/RoomContext.jsx';

const MESSAGE_MAX = 1000;
const KEEP_MESSAGES = 500;
const TYPING_SHOW_MS = 2500; // "is typing" disappears after this
const TYPING_SEND_MS = 1500; // how often we tell others that we are typing

const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function typingText(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

export default function ChatPanel() {
  const { initial, myId } = useRoom();
  const [messages, setMessages] = useState(() => initial?.chat ?? []);
  const [text, setText] = useState('');
  const [typers, setTypers] = useState({}); // userId -> name
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const lastTypingSent = useRef(0);

  // History from the server (also again after a reconnect, so nothing is missed)
  useEffect(() => {
    setMessages(initial?.chat ?? []);
  }, [initial]);

  useEffect(() => {
    const timers = new Map();

    const onMessage = (m) => {
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-KEEP_MESSAGES)));
      setTypers((prev) => {
        if (!(m.userId in prev)) return prev;
        const next = { ...prev };
        delete next[m.userId];
        return next;
      });
    };

    const onTyping = ({ userId, name }) => {
      setTypers((prev) => ({ ...prev, [userId]: name }));
      clearTimeout(timers.get(userId));
      timers.set(
        userId,
        setTimeout(() => {
          setTypers((prev) => {
            const next = { ...prev };
            delete next[userId];
            return next;
          });
        }, TYPING_SHOW_MS),
      );
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:typing', onTyping);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:typing', onTyping);
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  // Keep the newest message in view, unless you scrolled up to read old ones
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom || last?.userId === myId) el.scrollTop = el.scrollHeight;
  }, [messages, myId]);

  const handleChange = (e) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastTypingSent.current > TYPING_SEND_MS) {
      lastTypingSent.current = now;
      socket.emit('chat:typing');
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError('');
    socket.timeout(5000).emit('chat:send', { text: trimmed }, (err, res) => {
      setSending(false);
      if (err) return setError('The server did not answer. Try again.');
      if (!res.ok) return setError(res.error.message);
      setText(''); // the message comes back to everyone (including you) as 'chat:message'
    });
  };

  const typing = typingText(Object.values(typers));

  return (
    <section className="chat-panel fill d-flex flex-column border rounded" aria-label="Chat">
      <h2 className="h6 text-uppercase text-body-secondary px-3 pt-3 mb-2">Chat</h2>

      <div ref={listRef} className="fill overflow-auto px-3" role="log" aria-live="polite">
        {messages.length === 0 && <p className="text-body-secondary small">No messages yet. Say hi!</p>}
        {messages.map((m) => {
          const mine = m.userId === myId;
          return (
            <div key={m.id} className={`d-flex flex-column mb-2 ${mine ? 'align-items-end' : 'align-items-start'}`}>
              <div className="small text-body-secondary">
                {mine ? 'You' : m.name} · {formatTime(m.ts)}
              </div>
              <div
                className={`px-3 py-2 rounded-3 text-break ${mine ? 'bg-primary text-white' : 'bg-body-secondary'}`}
                style={{ maxWidth: '90%' }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      <div className="small text-body-secondary px-3" style={{ minHeight: '1.5em' }} aria-live="polite">
        {typing}
      </div>
      {error && (
        <div className="alert alert-warning py-1 px-2 mx-3 mb-2 small" role="alert">
          {error}
        </div>
      )}

      <form className="d-flex gap-2 p-3 pt-1" onSubmit={handleSend}>
        <input
          className="form-control"
          aria-label="Message"
          placeholder="Type a message…"
          value={text}
          maxLength={MESSAGE_MAX}
          autoComplete="off"
          onChange={handleChange}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}