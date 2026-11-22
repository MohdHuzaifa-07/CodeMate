import { io } from 'socket.io-client';
import { BACKEND_URL } from './config.js';

// One connection for the whole app. It only connects while you are inside a room.
export const socket = io(BACKEND_URL, { autoConnect: false, transports: ['websocket'] });