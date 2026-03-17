import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { makeBooking, detectProvider } from './booking.js';
import { loadRestaurant } from './restaurant.js';
import { ProviderFactory } from './llm/index.js';
import type { ChatMessage, ChatRequest, ChatResponse, BookRequest, RestaurantConfig } from './types.js';
import { bookingRouter } from './booking/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is one level up from dist/ (or src/ when using tsx)
const projectRoot = __dirname.endsWith('/dist') || __dirname.endsWith('/src')
  ? dirname(__dirname)
  : __dirname;

// --- Transcript logging ---
const transcriptDir = join(projectRoot, 'transcripts');
mkdirSync(transcriptDir, { recursive: true });

function logTranscript(sessionId: string, role: string, content: string): void {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const entry = { ts: now.toISOString(), role, content };
  appendFileSync(join(transcriptDir, `${date}_${sessionId}.jsonl`), JSON.stringify(entry) + '\n');
}

// --- LLM Provider ---
const LLM_MODEL = process.env.LLM_MODEL || process.env.OLLAMA_MODEL || 'llama3.1:8b';
const LLM_PROVIDER = process.env.LLM_PROVIDER; // auto-detect if not set
const provider = ProviderFactory.create(LLM_MODEL, LLM_PROVIDER);

// --- Restaurant context ---
const restaurantSlug = process.env.RESTAURANT || 'delhi-darbar';
const restaurant: RestaurantConfig | null = loadRestaurant(restaurantSlug, projectRoot);

if (restaurant) {
  console.log(`📋 Loaded restaurant: ${restaurant.name} (${restaurantSlug})`);
} else {
  console.warn(`⚠️  No restaurant data found for "${restaurantSlug}"`);
}

// --- Build system prompt ---
function buildSystemPrompt(): string {
  let prompt = `You are a friendly restaurant assistant for ${restaurant?.name || 'our restaurant'}. You help customers browse the menu, place orders, and make reservations.

Be concise, warm, and helpful.`;

  // Inject restaurant context FIRST so the LLM sees it early
  if (restaurant) {
    prompt += `\n\n## Restaurant: ${restaurant.name}`;
    if (restaurant.cuisine) prompt += `\nCuisine: ${restaurant.cuisine}`;
    if (restaurant.currency) prompt += `\nCurrency: ${restaurant.currency}`;
    if (restaurant.tagline) prompt += `\nTagline: ${restaurant.tagline}`;
    if (restaurant.knowledge) {
      prompt += `\n\n${restaurant.knowledge}`;
    }
  }

  prompt += `

## CRITICAL RULES
- ONLY use the menu and allergen information provided ABOVE. NEVER make up or invent menu items.
- If no menu is provided above, tell the customer the menu is not available yet.
- If allergen info is not available for a dish, say you're not sure and recommend asking staff.

## Ordering
When a customer wants to order:
1. Help them pick items from the menu above
2. Ask about customisations (spice level, extras, dietary needs)
3. Confirm quantities
4. Summarise the order before confirming

## Reservations / Bookings
When a customer wants to make a reservation or book a table:
1. Collect ALL of the following details:
   - **Date** (in YYYY-MM-DD format)
   - **Time** (in HH:MM 24-hour format)
   - **Party size** (number of guests)
   - **Name** (full name)
   - **Email**
   - **Phone number**
   - Any **special requests** (optional)
2. Ask for missing details conversationally — don't dump a form on them.
3. Once you have ALL required details, respond with a JSON block on its own line in this exact format:

\`\`\`json
{"action":"book","date":"YYYY-MM-DD","time":"HH:MM","partySize":N,"name":"...","email":"...","phone":"...","specialRequests":"..."}
\`\`\`

4. After the JSON block, add a friendly message like "Let me book that for you now! 🍽️"

IMPORTANT: Only output the JSON block when you have ALL required fields (date, time, partySize, name, email, phone). The system will detect this and trigger the booking automatically.

If a customer asks something unrelated to ordering food or making reservations, politely redirect them.`;

  return prompt;
}

const SYSTEM_PROMPT = buildSystemPrompt();

// --- Express app ---
const app = express();
app.use(express.json());
app.use(express.static(join(projectRoot, 'public')));
app.use(bookingRouter);

// In-memory session store
const sessions = new Map<string, ChatMessage[]>();

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body as ChatRequest;
    if (!sessionId || !message) {
      res.status(400).json({ error: 'sessionId and message required' });
      return;
    }

    // Get or create session history
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
    }
    const history = sessions.get(sessionId)!;
    history.push({ role: 'user', content: message });
    logTranscript(sessionId, 'user', message);

    // Call LLM via provider abstraction
    const reply = await provider.chat(history, SYSTEM_PROMPT) || 'Sorry, I could not generate a response.';
    history.push({ role: 'assistant', content: reply });
    logTranscript(sessionId, 'assistant', reply);

    // Check if the reply contains a booking action
    const bookingMatch = reply.match(
      /```json\s*\n?\s*(\{[^}]*"action"\s*:\s*"book"[^}]*\})\s*\n?\s*```/
    );
    if (bookingMatch) {
      try {
        const bookingData = JSON.parse(bookingMatch[1]);
        const response: ChatResponse = {
          reply,
          bookingPending: {
            date: bookingData.date,
            time: bookingData.time,
            partySize: bookingData.partySize,
            name: bookingData.name,
            email: bookingData.email,
            phone: bookingData.phone,
            specialRequests: bookingData.specialRequests || '',
          },
        };
        res.json(response);
        return;
      } catch {
        // JSON parse failed — just return the reply normally
      }
    }

    res.json({ reply } as ChatResponse);
  } catch (err) {
    console.error('Chat error:', (err as Error).message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// --- Booking endpoint ---
app.post('/api/book', async (req, res) => {
  try {
    const { bookingUrl, date, time, partySize, name, email, phone, specialRequests } = req.body as BookRequest;

    // Validate required fields
    const missing: string[] = [];
    if (!bookingUrl) missing.push('bookingUrl');
    if (!date) missing.push('date');
    if (!time) missing.push('time');
    if (!partySize) missing.push('partySize');
    if (!name) missing.push('name');
    if (!email) missing.push('email');
    if (!phone) missing.push('phone');
    if (missing.length > 0) {
      res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
      return;
    }

    // Check if we support this platform
    const detectedProvider = detectProvider(bookingUrl);
    if (!detectedProvider) {
      res.status(400).json({
        error: `Unsupported booking platform. Supported: SevenRooms, OpenTable, Resy.`,
        bookingUrl,
      });
      return;
    }

    console.log(
      `[booking] Starting ${detectedProvider.name} booking for ${name} — ${partySize} guests, ${date} ${time}`
    );

    const result = await makeBooking({
      bookingUrl,
      date,
      time,
      partySize: Number(partySize),
      name,
      email,
      phone,
      specialRequests: specialRequests || '',
    });

    console.log(`[booking] Result:`, result);
    res.json(result);
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ success: false, message: 'Internal booking error.' });
  }
});

const PORT = Number(process.env.PORT) || 3456;
app.listen(PORT, () => {
  console.log(`🍛 Restaurant Chat running on http://localhost:${PORT}`);
  console.log(`   LLM: ${provider.name} (model: ${LLM_MODEL})`);
  if (restaurant) {
    console.log(`   Restaurant: ${restaurant.name}`);
  }
});
