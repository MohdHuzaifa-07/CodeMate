import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AssistantPanel from '../components/AssistantPanel.jsx';
import CenteredMessage from '../components/CenteredMessage.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import CodeEditorPanel from '../components/CodeEditorPanel.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import UserList from '../components/UserList.jsx';
import Whiteboard from '../components/Whiteboard.jsx';
import { useToast } from '../components/Toasts.jsx';
import { RoomProvider, useRoom } from '../context/RoomContext.jsx';
import { isValidRoomCode, normalizeRoomCode } from '../lib/api.js';
import { NAME_MAX, cleanName, getSavedName, saveName } from '../lib/identity.js';

const ERROR_TEXT = {
  ROOM_NOT_FOUND: ['Room not found', 'This room does not exist any more. Ask the host for a new link.'],
  BAD_ROOM: ['Invalid room code', 'That room code does not look right.'],
  BAD_NAME: ['Invalid name', 'Please go back and enter a name.'],
};

export default function RoomPage() {
  const { roomId: rawRoomId } = useParams();
  const roomId = normalizeRoomCode(rawRoomId ?? '');
  const [name, setName] = useState(getSavedName);

  if (!isValidRoomCode(roomId)) {
    return (
      <CenteredMessage title="Invalid room link" text="A room code has 6 letters and numbers, like K7M2QX.">
        <Link to="/" className="btn btn-primary">
          Back to home
        </Link>
      </CenteredMessage>
    );
  }

  // Someone opened a shared link without a saved name: ask for it first
  if (!name) {
    return (
      <NamePrompt
        roomId={roomId}
        onSubmit={(n) => {
          saveName(n);
          setName(n);
        }}
      />
    );
  }

  return (
    <RoomProvider roomId={roomId} name={name}>
      <RoomShell />
    </RoomProvider>
  );
}

function NamePrompt({ roomId, onSubmit }) {
  const [value, setValue] = useState('');
  return (
    <CenteredMessage title={`Join room ${roomId}`} text="What should everyone call you?">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const n = cleanName(value);
          if (n) onSubmit(n);
        }}
      >
        <input
          className="form-control form-control-lg mb-3"
          aria-label="Your name"
          placeholder="Your name"
          value={value}
          maxLength={NAME_MAX}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn btn-success btn-lg w-100" disabled={!cleanName(value)}>
          Join room
        </button>
      </form>
    </CenteredMessage>
  );
}

function RoomShell() {
  const { roomId, status, error, connected, connectError, myId, users, leave } = useRoom();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('board');
  const [sideTab, setSideTab] = useState('chat');

  if (status === 'error') {
    const [title, text] = ERROR_TEXT[error?.code] ?? ['Could not join', error?.message ?? 'Something went wrong.'];
    return (
      <CenteredMessage title={title} text={text}>
        <Link to="/" className="btn btn-primary">
          Back to home
        </Link>
      </CenteredMessage>
    );
  }

  const copy = async (text, message) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(message, 'success');
    } catch {
      toast('Could not copy. Select the code and copy it by hand.', 'warning');
    }
  };

  const handleLeave = async () => {
    await leave();
    navigate('/');
  };

  let badge = <span className="badge text-bg-success">Connected</span>;
  if (!connected) {
    badge = connectError ? (
      <span className="badge text-bg-danger">Server unreachable</span>
    ) : (
      <span className="badge text-bg-warning">Connecting…</span>
    );
  }

  return (
    <div className="d-flex flex-column vh-100">
      <header className="d-flex flex-wrap align-items-center gap-2 border-bottom px-3 py-2">
        <span className="fw-bold me-2">CodeMate</span>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm font-monospace"
          onClick={() => copy(roomId, 'Room code copied')}
          title="Copy room code"
        >
          {roomId} 📋
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => copy(window.location.href, 'Invite link copied')}
        >
          Copy invite link
        </button>
        <span className="ms-auto d-flex align-items-center gap-2">
          {badge}
          <ThemeToggle />
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={handleLeave}>
            Leave
          </button>
        </span>
      </header>

      {status === 'connecting' ? (
        <div className="flex-grow-1 d-flex align-items-center justify-content-center gap-3">
          <div className="spinner-border" aria-hidden="true" />
          <span role="status">{connectError ? 'Cannot reach the server. Retrying…' : 'Joining room…'}</span>
        </div>
      ) : (
        <div className="room-body flex-grow-1 d-flex">
          <main className="room-main flex-grow-1 d-flex flex-column p-3">
            <ul className="nav nav-tabs mb-3">
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${tab === 'board' ? 'active' : ''}`}
                  onClick={() => setTab('board')}
                >
                  Whiteboard
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${tab === 'code' ? 'active' : ''}`}
                  onClick={() => setTab('code')}
                >
                  Code editor
                </button>
              </li>
            </ul>
            {/* Both stay mounted (just hidden), so nothing is missed while you look at the other tab */}
            <div className={`fill flex-column ${tab === 'board' ? 'd-flex' : 'd-none'}`}>
              <Whiteboard />
            </div>
            <div className={`fill flex-column ${tab === 'code' ? 'd-flex' : 'd-none'}`}>
              <CodeEditorPanel visible={tab === 'code'} />
            </div>
          </main>

          <aside className="sidebar border-start d-flex flex-column p-3 gap-3">
            <UserList users={users} myId={myId} />
            <ul className="nav nav-pills nav-fill">
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link py-1 ${sideTab === 'chat' ? 'active' : ''}`}
                  onClick={() => setSideTab('chat')}
                >
                  Chat
                </button>
              </li>
              <li className="nav-item">
                <button
                  type="button"
                  className={`nav-link py-1 ${sideTab === 'assistant' ? 'active' : ''}`}
                  onClick={() => setSideTab('assistant')}
                >
                  ✨ Assistant
                </button>
              </li>
            </ul>
            {/* Both stay mounted too, so the chat and your conversation with the assistant are kept */}
            <div className={`side-panel flex-column ${sideTab === 'chat' ? 'd-flex' : 'd-none'}`}>
              <ChatPanel />
            </div>
            <div className={`side-panel flex-column ${sideTab === 'assistant' ? 'd-flex' : 'd-none'}`}>
              <AssistantPanel />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}