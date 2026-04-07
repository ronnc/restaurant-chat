import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { makeBooking, detectProvider } from './booking.js';
import { loadRestaurant } from './restaurant.js';
import { ProviderFactory } from './llm/index.js';
import { PromptBuilder } from './prompt_builder.js';
import { LLMClient } from './llm_client.js';
import { ChatRequest, ChatResponse, BookRequest, RestaurantConfig } from './types.js';
import { bookingRouter, getSevenRooms } from './booking/index.js';
import { getPlaceDetails, getPlacePhotos } from './google-places.js';
import type { TimeSlot } from './booking/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = __dirname.endsWith('/dist') || __dirname.endsWith('/src')
  ? dirname(__dirname)
  : __dirname;

const transcriptDir = join(projectRoot, 'transcripts');
mkdirSync(transcript 
  ? transcriptDir : transcriptDir, { recursive: true });

function logTranscript(sessionId: string, role: string, content: string): void {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const entry = { ts: now.toISOString(), role, content };
  appendFileSync(join(transcriptDir, `${date}_${sessionId}.jsonl`), JSON.stringify(entry) + '\n');
}

const LLM_MODEL = process.env.LLM_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8.b';
const LLM_PROVIDER = process.env.LLM_PROVIDER; 
const provider = ProviderFactory.create(LLM_MODEL, LLM_PROVIDER);

const restaurantSlug = process.env.RESTAURANT || 'delhi-darbar';
const restaurant: RestaurantConfig | null = loadRestaurant(restaurantSlug, projectRoot);

const promptBuilder = restaurant ? new PromptBuilder(restaurant) : null;
const agent = promptBuilder ? new LLMClient(provider, promptBuilder.buildSystemPrompt()) : null;

const app = express();
app.use(express.json());
app.use(express.static(join(projectRoot, 'public')));
app.use(bookingRouter);

const sessions = new Map<string, any[]>();

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body as ChatRequest;
    if (!sessionId || !message) {
      res.status(400).json({ error: 'sessionId and message required' });
      return;
    }

    if (!agent) {
      res.status(500).json({ error: 'Agent not initialized' });
      return;
    }

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
    }
    const history = sessions.get(sessionId)!;
    history.push({ role: 'user', content: message });
    logTranscript(sessionId, 'user', message);

    const reply = await agent.generateResponse(message);

    const responseObj: ChatResponse = { reply };
    history.push({ role: 'assistant', content: reply });
    logTranscript(sessionId, 'assistant', reply);

    res.json(responseObj);
  } catch (err) {
    console.error('Chat error:', (err as Error).message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

const PORT = Number(process.env.PORT) || 3456;
app.listen(PORT, () => {
  console.log(`🍛 Restaurant Chat running on http://localhost:${PORT}`);
});
