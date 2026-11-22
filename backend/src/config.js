import 'dotenv/config';

const list = (value, fallback) =>
  (value ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT) || 5000,
  allowedOrigins: list(process.env.ALLOWED_ORIGINS, 'http://localhost:5173'),
  // How long a disconnected user keeps their seat (covers refresh / flaky wifi)
  userGraceMs: 10_000,
  // How long an empty room survives before it is deleted
  emptyRoomTtlMs: 30 * 60_000,
  // Hard cap so the in-memory store can't be filled by spam
  maxRooms: 500,
  // Chat history kept per room (oldest messages are dropped first)
  maxChatMessages: 200,
  // Whiteboard limits per room
  maxBoardElements: 3000,
  maxPointsPerElement: 3000,
  // Shared code editor
  maxCodeChars: 100_000,
  runsPerRoomPerMinute: 5,
  // Code execution (JDoodle). Keys come from .env and are never sent to the browser.
  jdoodleClientId: process.env.JDOODLE_CLIENT_ID,
  jdoodleClientSecret: process.env.JDOODLE_CLIENT_SECRET,
  runTimeoutMs: 15_000,
  // Stay under JDoodle's free daily quota (20 per day on the free plan)
  maxRunsPerDay: 15,
  // AI assistant (Google Gemini, free tier). The key comes from .env and is never sent to the browser.
  geminiApiKey: process.env.GEMINI_API_KEY,
  assistantModel: process.env.ASSISTANT_MODEL || 'gemini-3.5-flash-lite',
  assistantThinking: process.env.ASSISTANT_THINKING || 'low',
  assistantMaxTokens: 2000, // the model's "thinking" counts too, so this is more than the answer needs
  assistantTimeoutMs: 30_000,
  // Free tiers have limits, so keep these low. Check yours at aistudio.google.com/rate-limit
  asksPerRoomPerMinute: 4,
  maxAsksPerDay: 100,
};