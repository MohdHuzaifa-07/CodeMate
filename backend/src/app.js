import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomStore, normalizeRoomId } from './rooms/roomStore.js';
import { registerRoomHandlers } from './rooms/roomHandlers.js';
import { registerChatHandlers } from './chat/chatHandlers.js';
import { registerBoardHandlers } from './board/boardHandlers.js';
import { registerCodeHandlers } from './code/codeHandlers.js';
import { createJdoodleRunner } from './code/runner.js';
import { registerAssistantHandlers } from './assistant/assistantHandlers.js';
import { createAssistant } from './assistant/assistant.js';
import { createGeminiClient } from './assistant/geminiClient.js';

export function buildServer(config, deps = {}) {
  const app = express();
  app.use(cors({ origin: config.allowedOrigins, methods: ['GET', 'POST'] }));
  app.use(express.json({ limit: '100kb' }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'] },
  });

  const store = new RoomStore({
    ...config,
    // Fires when a user is finally removed (grace period over, or they left)
    onPresenceChange: ({ room, left }) => {
      io.to(room.id).emit('room:user-left', { name: left });
      io.to(room.id).emit('room:users', store.publicUsers(room));
    },
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/api/rooms', (_req, res) => {
    const room = store.createRoom();
    if (!room) return res.status(503).json({ error: 'Server is busy, try again later' });
    res.status(201).json({ roomId: room.id });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const id = normalizeRoomId(req.params.roomId);
    res.json({ exists: Boolean(id && store.has(id)) });
  });

  registerRoomHandlers(io, store);
  registerChatHandlers(io, store);
  registerBoardHandlers(io, store);

  // Tests pass in a fake runner so they never call the real service.
  const runner =
    deps.runner ??
    createJdoodleRunner({
      clientId: config.jdoodleClientId,
      clientSecret: config.jdoodleClientSecret,
      timeoutMs: config.runTimeoutMs,
      maxRunsPerDay: config.maxRunsPerDay,
    });
  registerCodeHandlers(io, store, { runner, runsPerRoomPerMinute: config.runsPerRoomPerMinute });

  // Tests pass in an assistant with a fake AI service so they never use up your free quota.
  const assistant =
    deps.assistant ??
    createAssistant({
      enabled: Boolean(config.geminiApiKey),
      complete: createGeminiClient({
        apiKey: config.geminiApiKey,
        model: config.assistantModel,
        maxTokens: config.assistantMaxTokens,
        thinkingLevel: config.assistantThinking,
        timeoutMs: config.assistantTimeoutMs,
      }),
    });
  registerAssistantHandlers(io, store, {
    assistant,
    asksPerRoomPerMinute: config.asksPerRoomPerMinute,
    maxAsksPerDay: config.maxAsksPerDay,
  });

  const close = async () => {
    store.dispose();
    await io.close();
  };

  return { app, httpServer, io, store, close };
}