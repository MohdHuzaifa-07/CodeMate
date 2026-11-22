import { before, after } from 'node:test';
import { io as connect } from 'socket.io-client';
import { buildServer } from '../src/app.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clientId = () => crypto.randomUUID();

/** Resolves with the event payload, or rejects if it never arrives. */
export const waitFor = (socket, event, ms = 1000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), ms);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

/** Starts a real server on a random port for the whole test file. */
export function useTestServer(overrides = {}, deps = {}) {
  const config = {
    allowedOrigins: ['http://localhost:5173'],
    userGraceMs: 150,
    emptyRoomTtlMs: 60_000,
    maxRooms: 50,
    maxChatMessages: 200,
    ...overrides,
  };
  const env = { base: '', ctx: null, clients: [] };

  before(async () => {
    env.ctx = buildServer(config, deps);
    await new Promise((resolve) => env.ctx.httpServer.listen(0, resolve));
    env.base = `http://localhost:${env.ctx.httpServer.address().port}`;
  });

  after(async () => {
    env.clients.forEach((s) => s.disconnect());
    await env.ctx.close();
    env.ctx.httpServer.close();
  });

  env.socket = () => {
    const s = connect(env.base, { transports: ['websocket'], forceNew: true });
    env.clients.push(s);
    return s;
  };
  env.join = (s, payload) => s.timeout(2000).emitWithAck('room:join', payload);
  env.send = (s, text) => s.timeout(2000).emitWithAck('chat:send', { text });
  env.createRoom = async () => (await fetch(`${env.base}/api/rooms`, { method: 'POST' })).json();
  /** Convenience: new socket already joined to a room. */
  env.joined = async (roomId, name) => {
    const s = env.socket();
    const res = await env.join(s, { roomId, name, clientId: clientId() });
    return { s, res };
  };
  return env;
}