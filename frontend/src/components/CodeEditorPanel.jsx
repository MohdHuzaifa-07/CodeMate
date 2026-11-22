import { Suspense, lazy, useEffect, useState } from 'react';
import { socket } from '../lib/socket.js';
import { useRoom } from '../context/RoomContext.jsx';
import { CodeSync } from '../lib/codeSync.js';
import { LANGUAGES, languageLabel } from '../lib/languages.js';

// The editor is big, so it is only downloaded when someone opens the Code tab
const MonacoEditor = lazy(() => import('./MonacoEditor.jsx'));

const formatTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const MIN_OUTPUT_HEIGHT = 80;

export default function CodeEditorPanel({ visible }) {
  const { initial, myId, users } = useRoom();
  const [sync, setSync] = useState(null);
  const [everShown, setEverShown] = useState(visible);
  const [language, setLanguage] = useState(initial?.code?.language ?? 'javascript');
  const [running, setRunning] = useState(initial?.code?.running ? { by: null } : null);
  const [lastRun, setLastRun] = useState(initial?.code?.lastRun ?? null);
  const [runError, setRunError] = useState('');
  const [outputHeight, setOutputHeight] = useState(200);

  useEffect(() => {
    if (visible) setEverShown(true);
  }, [visible]);

  // The shared text lives here, not inside the editor, so it keeps syncing while the tab is hidden
  useEffect(() => {
    const s = new CodeSync(socket);
    s.attach();
    setSync(s);
    return () => {
      s.destroy();
      setSync(null);
    };
  }, []);

  useEffect(() => {
    if (sync && myId) sync.setIdentity({ id: myId });
  }, [sync, myId]);

  // The server's copy of the code: when we join, and again after every reconnect
  useEffect(() => {
    if (sync && initial?.code) sync.applySnapshot(initial.code);
  }, [sync, initial]);

  useEffect(() => {
    sync?.pruneAwareness(users);
  }, [sync, users]);

  useEffect(() => {
    if (!initial?.code) return;
    setLanguage(initial.code.language);
    setLastRun(initial.code.lastRun);
    setRunning((prev) => (initial.code.running ? (prev ?? { by: null }) : null));
  }, [initial]);

  useEffect(() => {
    const onLanguage = ({ language: next }) => setLanguage(next);
    const onStarted = ({ id, by, language: lang }) => {
      setRunning({ id, by, language: lang });
      setRunError('');
    };
    const onResult = (result) => {
      setRunning(null);
      setLastRun(result);
    };
    socket.on('code:language', onLanguage);
    socket.on('code:run-started', onStarted);
    socket.on('code:run-result', onResult);
    return () => {
      socket.off('code:language', onLanguage);
      socket.off('code:run-started', onStarted);
      socket.off('code:run-result', onResult);
    };
  }, []);

  const changeLanguage = (e) => {
    // The new language comes back from the server to everyone, including you
    socket.timeout(5000).emit('code:language', { language: e.target.value }, (err, res) => {
      if (err || !res?.ok) setRunError(res?.error?.message ?? 'Could not change the language.');
    });
  };

  const run = () => {
    setRunError('');
    socket.timeout(5000).emit('code:run', {}, (err, res) => {
      if (err) return setRunError('The server did not answer. Try again.');
      if (!res.ok) setRunError(res.error.message);
    });
  };

  // Drag the bar between the editor and the output to resize the output box
  const startDrag = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = outputHeight;
    const onMove = (ev) => {
      const next = startHeight + (startY - ev.clientY); // dragging up makes the output taller
      setOutputHeight(Math.min(window.innerHeight * 0.7, Math.max(MIN_OUTPUT_HEIGHT, next)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="d-flex flex-column fill">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
        <label className="d-flex align-items-center gap-2 mb-0">
          <span className="small">Language</span>
          <select className="form-select form-select-sm w-auto" value={language} onChange={changeLanguage}>
            {LANGUAGES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-success btn-sm" onClick={run} disabled={Boolean(running)}>
          {running ? 'Running…' : '▶ Run code'}
        </button>
        <span className="small text-body-secondary ms-auto">Everyone in the room sees the output.</span>
      </div>

      <div className="editor-wrap fill border rounded overflow-hidden">
        {everShown && sync && (
          <Suspense
            fallback={
              <div className="h-100 d-flex align-items-center justify-content-center gap-2 text-body-secondary">
                <div className="spinner-border spinner-border-sm" aria-hidden="true" />
                <span role="status">Loading editor…</span>
              </div>
            }
          >
            <MonacoEditor key={sync.doc.guid} sync={sync} language={language} />
          </Suspense>
        )}
      </div>

      <div
        className="output-divider"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize"
        onPointerDown={startDrag}
      />

      <section className="output-panel border rounded p-2" style={{ height: outputHeight }} aria-label="Output">
        {runError && (
          <div className="alert alert-warning py-1 px-2 small mb-2" role="alert">
            {runError}
          </div>
        )}
        {running ? (
          <div className="d-flex align-items-center gap-2 text-body-secondary">
            <div className="spinner-border spinner-border-sm" aria-hidden="true" />
            <span role="status">{running.by ? `Running… started by ${running.by.name}` : 'A run is in progress…'}</span>
          </div>
        ) : lastRun ? (
          <>
            <div className="small text-body-secondary mb-1">
              {lastRun.by.name} ran {languageLabel(lastRun.language)} · {formatTime(lastRun.ts)}
              {lastRun.cpuTime ? ` · ${lastRun.cpuTime}s CPU` : ''}
            </div>
            {lastRun.error ? (
              <div className="alert alert-danger py-1 px-2 small mb-0" role="alert">
                {lastRun.error}
              </div>
            ) : (
              <pre className="output-text mb-0">{lastRun.output || '(no output)'}</pre>
            )}
          </>
        ) : (
          !runError && <p className="text-body-secondary small mb-0">Run the code to see the output here.</p>
        )}
      </section>
    </div>
  );
}