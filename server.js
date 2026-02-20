import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // TODO: ollama provider
  if (name === 'ollama') {
    const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    return {
      async chat(messages, systemPrompt) {
        const resp = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'llama3',
            stream: false,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
            ],
          }),
        });
        const data = await resp.json();
        return data.message.content;
      },
    };
  }
  throw new Error(`Unknown provider: ${name}`);
}

const providerName = process.env.LLM_PROVIDER || 'anthropic';
const provider = createProvider(providerName);

const SYSTEM_PROMPT = `You are a friendly restaurant ordering assistant. You help customers browse the menu and place orders through conversation.

Be concise, warm, and helpful. When a customer wants to order:
1. Help them pick items from the menu
2. Ask about customisations (spice level, extras, dietary needs)
3. Confirm quantities
4. Summarise the order before confirming

For now, you're a demo — make up a sample Thai restaurant menu with reasonable prices in AUD. Include categories like Mains, Sides, Drinks, Desserts. Keep it authentic.

If a customer asks something unrelated to ordering food, politely redirect them.`;

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

    // Call LLM
    const reply = await provider.chat(history, SYSTEM_PROMPT);
    history.push({ role: 'assistant', content: reply });

    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`🍜 Restaurant Chat running on http://localhost:${PORT}`);
  console.log(`   LLM Provider: ${providerName}`);
});
