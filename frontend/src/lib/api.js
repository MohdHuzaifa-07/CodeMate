import { BACKEND_URL } from './config.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp(`^[${ALPHABET}]{6}$`);

export const normalizeRoomCode = (value) => value.replace(/\s+/g, '').toUpperCase();
export const isValidRoomCode = (value) => CODE_RE.test(value);

async function request(path, options) {
  let res;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, options);
  } catch {
    throw new Error('Cannot reach the server. Is the backend running?');
  }
  if (!res.ok) {
    let message = 'Something went wrong. Please try again.';
    try {
      message = (await res.json()).error || message;
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  return res.json();
}

export const createRoom = async () => (await request('/api/rooms', { method: 'POST' })).roomId;
export const roomExists = async (roomId) => (await request(`/api/rooms/${roomId}`)).exists;