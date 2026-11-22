import { randomInt, randomUUID } from 'node:crypto';
import { Board } from '../board/board.js';
import { CodeSession } from '../code/codeSession.js';

// No 0/O/1/I so codes are easy to read out loud
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);

const generateCode = () =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Returns a clean upper-case room code, or null if it is not a valid code. */
export function normalizeRoomId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toUpperCase();
  return CODE_RE.test(id) ? id : null;
}

/**
 * In-memory rooms. Everything else in the app talks to this class only,
 * so swapping it for a database-backed version later is a local change.
 *
 * Identity model:
 *  - clientId : secret random id the browser keeps. Never sent to other users.
 *  - user.id  : public id shown to everyone. Safe to expose.
 *  A user is keyed by clientId, so a refresh or reconnect gets the same seat back.
 */
export class RoomStore {
  constructor({
    userGraceMs,
    emptyRoomTtlMs,
    maxRooms,
    maxChatMessages = 200,
    maxBoardElements = 3000,
    maxPointsPerElement = 3000,
    maxCodeChars = 100_000,
    onPresenceChange = () => {},
  }) {
    this.userGraceMs = userGraceMs;
    this.emptyRoomTtlMs = emptyRoomTtlMs;
    this.maxRooms = maxRooms;
    this.maxChatMessages = maxChatMessages;
    this.boardLimits = { maxElements: maxBoardElements, maxPointsPerElement };
    this.codeLimits = { maxChars: maxCodeChars };
    this.onPresenceChange = onPresenceChange;
    this.rooms = new Map(); // roomId -> room
    this.sockets = new Map(); // socketId -> { roomId, clientId }
  }

  createRoom() {
    if (this.rooms.size >= this.maxRooms) return null;
    let id;
    do id = generateCode();
    while (this.rooms.has(id));
    const room = {
      id,
      createdAt: Date.now(),
      users: new Map(),
      hostClientId: null,
      emptyTimer: null,
      chat: [],
      board: new Board(this.boardLimits),
      code: new CodeSession(this.codeLimits),
    };
    this.rooms.set(id, room);
    this.#scheduleEmptyCleanup(room);
    return room;
  }

  has(roomId) {
    return this.rooms.has(roomId);
  }

  roomOfSocket(socketId) {
    return this.sockets.get(socketId)?.roomId ?? null;
  }

  /** Join, or rejoin with the same clientId. Returns null if the room does not exist. */
  join({ roomId, clientId, name, socketId }) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;

    let user = room.users.get(clientId);
    const rejoined = Boolean(user);
    if (user) {
      clearTimeout(user.graceTimer);
      user.graceTimer = null;
      if (user.socketId) this.sockets.delete(user.socketId); // newest tab wins
      user.socketId = socketId;
      user.connected = true;
      user.name = name;
    } else {
      user = { id: randomUUID().slice(0, 8), clientId, name, socketId, connected: true, graceTimer: null };
      room.users.set(clientId, user);
    }

    // The server decides roles: first person in becomes host
    if (!room.hostClientId) room.hostClientId = clientId;

    this.sockets.set(socketId, { roomId, clientId });
    return { room, user, rejoined };
  }

  /** Socket dropped. The user keeps their seat for a grace period. Returns the room. */
  leave(socketId) {
    const ref = this.sockets.get(socketId);
    if (!ref) return null;
    this.sockets.delete(socketId);
    const room = this.rooms.get(ref.roomId);
    const user = room?.users.get(ref.clientId);
    if (!user || user.socketId !== socketId) return null; // stale socket
    user.connected = false;
    user.socketId = null;
    user.graceTimer = setTimeout(() => this.#removeUser(room, user), this.userGraceMs);
    user.graceTimer.unref?.();
    return room;
  }

  /** User clicked "leave". Remove them immediately. */
  leaveNow(socketId) {
    const ref = this.sockets.get(socketId);
    if (!ref) return;
    this.sockets.delete(socketId);
    const room = this.rooms.get(ref.roomId);
    const user = room?.users.get(ref.clientId);
    if (user && user.socketId === socketId) this.#removeUser(room, user);
  }

  /** Who is behind this socket? Returns { room, user } or null. */
  memberOf(socketId) {
    const ref = this.sockets.get(socketId);
    const room = ref && this.rooms.get(ref.roomId);
    const user = room?.users.get(ref.clientId);
    return user ? { room, user } : null;
  }

  addMessage(room, user, text) {
    const message = { id: randomUUID(), userId: user.id, name: user.name, text, ts: Date.now() };
    room.chat.push(message);
    if (room.chat.length > this.maxChatMessages) room.chat.shift();
    return message;
  }

  publicUsers(room) {
    return [...room.users.values()].map((u) => this.#publicUser(room, u));
  }

  snapshot(room, user) {
    return {
      roomId: room.id,
      you: this.#publicUser(room, user),
      users: this.publicUsers(room),
      chat: room.chat,
      board: room.board.snapshot(),
      code: room.code.snapshot(),
    };
  }

  dispose() {
    for (const room of this.rooms.values()) {
      clearTimeout(room.emptyTimer);
      for (const u of room.users.values()) clearTimeout(u.graceTimer);
    }
  }

  #publicUser(room, u) {
    return { id: u.id, name: u.name, isHost: room.hostClientId === u.clientId, connected: u.connected };
  }

  #removeUser(room, user) {
    clearTimeout(user.graceTimer);
    room.users.delete(user.clientId);
    if (room.hostClientId === user.clientId) {
      const users = [...room.users.values()];
      const next = users.find((u) => u.connected) ?? users[0];
      room.hostClientId = next ? next.clientId : null;
    }
    if (room.users.size === 0) this.#scheduleEmptyCleanup(room);
    this.onPresenceChange({ room, left: user.name });
  }

  #scheduleEmptyCleanup(room) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = setTimeout(() => {
      if (room.users.size === 0) this.rooms.delete(room.id);
    }, this.emptyRoomTtlMs);
    room.emptyTimer.unref?.();
  }
}