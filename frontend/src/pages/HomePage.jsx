import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { createRoom, isValidRoomCode, normalizeRoomCode, roomExists } from '../lib/api.js';
import { NAME_MAX, cleanName, getSavedName, saveName } from '../lib/identity.js';

export default function HomePage() {
  const navigate = useNavigate();
  const [name, setName] = useState(getSavedName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'create' | 'join'
  const [error, setError] = useState('');

  const enterRoom = (roomId, finalName) => {
    saveName(finalName);
    navigate(`/room/${roomId}`);
  };

  async function handleCreate(e) {
    e.preventDefault();
    const finalName = cleanName(name);
    if (!finalName) return setError('Please enter your name first.');
    setError('');
    setBusy('create');
    try {
      enterRoom(await createRoom(), finalName);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  async function handleJoin(e) {
    e.preventDefault();
    const finalName = cleanName(name);
    if (!finalName) return setError('Please enter your name first.');
    if (!isValidRoomCode(code)) return setError('A room code has 6 letters and numbers, like K7M2QX.');
    setError('');
    setBusy('join');
    try {
      if (!(await roomExists(code))) {
        setError('No room with that code. Check it and try again.');
        setBusy('');
        return;
      }
      enterRoom(code, finalName);
    } catch (err) {
      setError(err.message);
      setBusy('');
    }
  }

  return (
    <div className="min-vh-100 d-flex flex-column">
      <header className="d-flex justify-content-end p-3">
        <ThemeToggle />
      </header>

      <main className="container pb-5 flex-grow-1" style={{ maxWidth: 860 }}>
        <div className="text-center mb-4">
          <h1 className="display-5 fw-bold">CodeMate</h1>
          <p className="lead text-body-secondary">Draw, code and chat together in real time.</p>
        </div>

        <div className="mb-4">
          <label htmlFor="name" className="form-label">
            Your name
          </label>
          <input
            id="name"
            className="form-control form-control-lg"
            value={name}
            maxLength={NAME_MAX}
            placeholder="e.g. Mariyam"
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        <div className="row g-4">
          <div className="col-md-6">
            <form className="card h-100" onSubmit={handleCreate}>
              <div className="card-body d-flex flex-column">
                <h2 className="h4">Create a room</h2>
                <p className="text-body-secondary flex-grow-1">
                  Start a new room and share its code with your friends. You will be the host.
                </p>
                <button type="submit" className="btn btn-primary btn-lg" disabled={Boolean(busy)}>
                  {busy === 'create' ? 'Creating…' : 'Create room'}
                </button>
              </div>
            </form>
          </div>

          <div className="col-md-6">
            <form className="card h-100" onSubmit={handleJoin}>
              <div className="card-body d-flex flex-column">
                <h2 className="h4">Join a room</h2>
                <label htmlFor="code" className="form-label text-body-secondary">
                  Room code
                </label>
                <input
                  id="code"
                  className="form-control form-control-lg font-monospace mb-3"
                  value={code}
                  placeholder="K7M2QX"
                  autoComplete="off"
                  onChange={(e) => setCode(normalizeRoomCode(e.target.value).slice(0, 6))}
                />
                <button type="submit" className="btn btn-success btn-lg mt-auto" disabled={Boolean(busy)}>
                  {busy === 'join' ? 'Joining…' : 'Join room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}