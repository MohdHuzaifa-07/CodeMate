import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import Editor, { loader } from '@monaco-editor/react';
import { MonacoBinding } from 'y-monaco';
import { useRoom } from '../context/RoomContext.jsx';
import { buildCursorCss } from '../lib/cursorCss.js';
import { useColorMode } from '../lib/useColorMode.js';

// Use the editor that ships with the app (no download from the internet)
self.MonacoEnvironment = {
  getWorker: (_id, label) => (label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()),
};
loader.config({ monaco });

const OPTIONS = {
  fontSize: 15,
  minimap: { enabled: false },
  automaticLayout: true, // follows the size of its box, also when the tab becomes visible
  scrollBeyondLastLine: false,
  tabSize: 2,
  padding: { top: 8 },
};

/** Shows the shared text in Monaco. The binding keeps Monaco and the shared text identical. */
export default function MonacoEditor({ sync, language }) {
  const { users } = useRoom();
  const colorMode = useColorMode();
  const bindingRef = useRef(null);

  const handleMount = (editor) => {
    bindingRef.current?.destroy();
    bindingRef.current = new MonacoBinding(sync.ytext, editor.getModel(), new Set([editor]), sync.awareness);
  };

  useEffect(
    () => () => {
      bindingRef.current?.destroy();
      bindingRef.current = null;
    },
    [],
  );

  // Colors and name tags for other people's cursors
  useEffect(() => {
    const style = document.createElement('style');
    document.head.appendChild(style);
    const update = () => {
      style.textContent = buildCursorCss(sync.awareness.getStates(), sync.doc.clientID, users);
    };
    update();
    sync.awareness.on('change', update);
    return () => {
      sync.awareness.off('change', update);
      style.remove();
    };
  }, [sync, users]);

  return (
    <Editor
      height="100%"
      language={language}
      theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
      options={OPTIONS}
      onMount={handleMount}
    />
  );
}