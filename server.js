import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { makeBooking, detectProvider } from './booking.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Transcript logging ---
const transcriptDir = join(__dirname, 'transcripts');
mkdirSync(transcriptDir, { recursive: true });

function logTranscript(sessionId, role, content) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const entry = { ts: now.toISOString(), role, content };
  appendFileSync(join(transcriptDir, `${date}_${sessionId}.jsonl`), JSON.stringify(entry) + '\n');
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// --- LLM Provider Abstraction ---
function createProvider(name) {
  if (name === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return {
      async chat(messages, systemPrompt) {
        const resp = await client.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });
        return resp.content[0].text;
      },
    };
  }
  // Ollama or chat-client-toy (both OpenAI-compatible)
  if (name === 'ollama') {
    const gatewayUrl = process.env.LLM_GATEWAY_URL || 'http://localhost:11434';
    return {
      async chat(messages, systemPrompt) {
        const resp = await fetch(`${gatewayUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'llama3.1:8b',
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
          }),
        });
        const data = await resp.json();
        return data.choices[0].message.content;
      },
    };
  }
  throw new Error(`Unknown provider: ${name}`);
}

const providerName = process.env.LLM_PROVIDER || 'anthropic';
const provider = createProvider(providerName);

const SYSTEM_PROMPT = `You are a friendly restaurant assistant. You help customers browse the menu, place orders, and **make reservations** through conversation.

Be concise, warm, and helpful.

## Ordering
When a customer wants to order:
1. Help them pick items from the menu
2. Ask about customisations (spice level, extras, dietary needs)
3. Confirm quantities
4. Summarise the order before confirming

Present the menu in markdown table format when asked.

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

// In-memory session store (swap for DB later)
const sessions = new Map();

app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message required' });
    }

    // Get or create session history
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, []);
    }
    const history = sessions.get(sessionId);
    history.push({ role: 'user', content: message });
    logTranscript(sessionId, 'user', message);

    // Call LLM
    const reply = await provider.chat(history, SYSTEM_PROMPT);
    history.push({ role: 'assistant', content: reply });
    logTranscript(sessionId, 'assistant', reply);

    // Check if the reply contains a booking action
    const bookingMatch = reply.match(/```json\s*\n?\s*(\{[^}]*"action"\s*:\s*"book"[^}]*\})\s*\n?\s*```/);
    if (bookingMatch) {
      try {
        const bookingData = JSON.parse(bookingMatch[1]);
        // Return the reply with booking data attached so the client can trigger /api/book
        return res.json({
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
        });
      } catch {
        // JSON parse failed — just return the reply normally
      }
    }

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

// --- Booking endpoint ---
app.post('/api/book', async (req, res) => {
  try {
    const { bookingUrl, date, time, partySize, name, email, phone, specialRequests } = req.body;

    // Validate required fields
    const missing = [];
    if (!bookingUrl) missing.push('bookingUrl');
    if (!date) missing.push('date');
    if (!time) missing.push('time');
    if (!partySize) missing.push('partySize');
    if (!name) missing.push('name');
    if (!email) missing.push('email');
    if (!phone) missing.push('phone');
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    // Check if we support this platform
    const detectedProvider = detectProvider(bookingUrl);
    if (!detectedProvider) {
      return res.status(400).json({
        error: `Unsupported booking platform. Supported: SevenRooms, OpenTable, Resy.`,
        bookingUrl,
      });
    }

    console.log(`[booking] Starting ${detectedProvider.name} booking for ${name} — ${partySize} guests, ${date} ${time}`);

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

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`🍛 Restaurant Chat running on http://localhost:${PORT}`);
  console.log(`   LLM Provider: ${providerName}`);
});
