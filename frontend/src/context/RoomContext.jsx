import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { socket } from '../lib/socket.js';
import { getClientId } from '../lib/identity.js';
import { useToast } from '../components/Toasts.jsx';

const RoomContext = createContext(null);
export const useRoom = () => useContext(RoomContext);

/**
 * Connects to the backend and keeps the room's shared state:
 * who is here, who you are, and the starting data (chat, board, code) from the join snapshot.
 * It joins again by itself whenever the connection comes back, so a refresh or a Wi-Fi drop
 * brings you back to the same seat.
 */
export function RoomProvider({ roomId, name, children }) {
  const toast = useToast();
  const [connected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState(false);
  const [status, setStatus] = useState('connecting'); // connecting | ready | error
  const [error, setError] = useState(null);
  const [myId, setMyId] = useState(null);
  const [users, setUsers] = useState([]);
  const [initial, setInitial] = useState(null);

  useEffect(() => {
    let retryTimer = null;

    const join = () => {
      socket.timeout(8000).emit('room:join', { roomId, name, clientId: getClientId() }, (err, res) => {
        if (err) {
          retryTimer = setTimeout(join, 2000); // the server did not answer in time: try again
          return;
        }
        if (!res.ok) {
          setError(res.error);
          setStatus('error');
          return;
        }
        setMyId(res.snapshot.you.id);
        setUsers(res.snapshot.users);
        setInitial(res.snapshot);
        setError(null);
        setStatus('ready');
      });
    };

    const onConnect = () => {
      setConnected(true);
      setConnectError(false);
      join();
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => {
      setConnected(false);
      setConnectError(true);
    };
    const onUsers = (list) => setUsers(list);
    const onUserJoined = ({ name: who }) => toast(`${who} joined`, 'success');
    const onUserLeft = ({ name: who }) => toast(`${who} left`, 'secondary');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room:users', onUsers);
    socket.on('room:user-joined', onUserJoined);
    socket.on('room:user-left', onUserLeft);
    socket.connect();

    return () => {
      clearTimeout(retryTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room:users', onUsers);
      socket.off('room:user-joined', onUserJoined);
      socket.off('room:user-left', onUserLeft);
      // The server keeps your seat for a few seconds, so a refresh puts you right back.
      socket.disconnect();
    };
  }, [roomId, name, toast]);

  /** Leave on purpose: gives up the seat right away. */
  const leave = useCallback(
    () =>
      new Promise((resolve) => {
        if (!socket.connected) return resolve();
        socket.timeout(2000).emit('room:leave', {}, () => resolve());
      }),
    [],
  );

  const me = useMemo(() => users.find((u) => u.id === myId) ?? null, [users, myId]);

  const value = useMemo(
    () => ({ roomId, status, error, connected, connectError, myId, me, users, initial, leave }),
    [roomId, status, error, connected, connectError, myId, me, users, initial, leave],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}