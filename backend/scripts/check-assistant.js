// Run with:  npm run check-assistant
// Makes real calls to Gemini using the key in backend/.env, so you can see that the assistant works.
import { config } from '../src/config.js';
import { createGeminiClient, AssistantError } from '../src/assistant/geminiClient.js';
import { createAssistant } from '../src/assistant/assistant.js';

if (!config.geminiApiKey) {
  console.log('No GEMINI_API_KEY found in backend/.env.');
  console.log('Get a free key at https://aistudio.google.com/apikey and add this line to backend/.env:');
  console.log('GEMINI_API_KEY=your-key-here');
  process.exit(1);
}

const complete = createGeminiClient({
  apiKey: config.geminiApiKey,
  model: config.assistantModel,
  maxTokens: config.assistantMaxTokens,
  thinkingLevel: config.assistantThinking,
  timeoutMs: config.assistantTimeoutMs,
});

function explain(err) {
  if (err instanceof AssistantError) return `${err.code}: ${err.message}`;
  return String(err?.message ?? err);
}

console.log(`Model: ${config.assistantModel}  (thinking: ${config.assistantThinking})\n`);

try {
  console.log('1) A plain question...');
  const hello = await complete({
    system: 'You are a helpful assistant. Answer in one short sentence.',
    messages: [{ role: 'user', content: 'Say hello and tell me which AI model you are, if you know.' }],
  });
  console.log(`   OK: ${hello.trim()}\n`);

  console.log('2) A question about a pretend room (this uses the same search and prompt as the real app)...');
  const assistant = createAssistant({ complete });
  const room = {
    chat: [
      { id: '1', userId: 'a', name: 'Mariyam', text: 'we should use postgres for storage', ts: Date.now() },
      { id: '2', userId: 'b', name: 'Hamza', text: 'ok, I will run my script now', ts: Date.now() },
    ],
    code: {
      text: 'items = [1, 2, 3]\nprint(items[5])',
      language: 'python',
      lastRun: { by: { name: 'Hamza' }, language: 'python', output: 'IndexError: list index out of range', error: null },
    },
  };
  const { answer, sources } = await assistant.ask({ room, asker: { name: 'Mariyam' }, question: 'Why did the last run fail?' });
  console.log(`   OK: ${answer}`);
  console.log(`   Based on: ${sources.map((s) => `${s.id} ${s.label}`).join(' · ')}\n`);

  console.log('3) A follow-up question...');
  const followUp = await assistant.ask({
    room,
    asker: { name: 'Mariyam' },
    question: 'And how do I fix it?',
    history: [{ q: 'Why did the last run fail?', a: answer }],
  });
  console.log(`   OK: ${followUp.answer}\n`);

  console.log('Everything works. The assistant is ready.');
} catch (err) {
  console.log(`   FAILED -> ${explain(err)}`);
  console.log('\nThe server log above this line (if any) has more detail. Send me this output (without your key) and I will fix it.');
  process.exit(1);
}