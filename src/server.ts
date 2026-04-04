import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { makeBooking, detectProvider } from './booking.js';
import { loadRestaurant } from './restaurant.js';
import { ProviderFactory } from './llm/index.js';
import type { ChatMessage, ChatRequest, ChatResponse, BookRequest, RestaurantConfig } from './types.js';
import { bookingRouter, getSevenRooms } from './booking/index.js';
import { getPlaceDetails, getPlacePhotos } from './google-places.js';
import type { TimeSlot } from './booking/index.js';

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

## CRITICAL RULES — READ CAREFULLY
1. **MENU IS YOUR ONLY SOURCE OF TRUTH.** The menu provided above is the COMPLETE and ONLY list of dishes we serve. If a dish is NOT listed in the menu above, we DO NOT serve it. Period.
2. **NEVER invent, guess, or hallucinate menu items.** Do not add dishes, sides, drinks, or extras that are not explicitly listed above. If you are unsure whether something is on the menu, say "I don't see that on our menu" rather than guessing.
3. If a customer asks for something not on the menu, say: "I'm sorry, I don't see that on our menu. Here's what we do have..." and suggest similar items FROM THE MENU ONLY.
4. If no menu is provided above, tell the customer the menu is not available yet.
5. If allergen info is not available for a dish, say you're not sure and recommend asking staff.
6. When listing or recommending dishes, ONLY mention items that appear word-for-word in the menu above.
7. **ALWAYS include the price** when mentioning any dish. Every item on the menu has a price — always show it (e.g. "Butter Chicken 1950s — £13.50"). Never list a dish without its price.
8. **menu.md is the ONLY source for what we serve.** The allergen document may reference items that are no longer on the menu. If a dish appears in allergen info but NOT in the menu, it is discontinued — do not mention it, recommend it, or confirm we serve it.

## Ordering
When a customer wants to order:
1. Help them pick items from the menu above — ONLY items listed there
2. Ask about customisations (spice level, extras, dietary needs)
3. Confirm quantities
4. Summarise the order before confirming — double-check every item exists on the menu

## Table availability (live)
When the customer asks what times are free, available slots, open reservations, or similar for a **specific date**:
1. You need **date** (YYYY-MM-DD) and **party size** (2–10 guests). If either is missing, ask for it first — do not guess dates.
2. When you have both, output a **single** JSON code block so the system can load live availability from SevenRooms:

\`\`\`json
{"action":"availability","date":"YYYY-MM-DD","partySize":4}
\`\`\`

3. You may add a short line before or after the block (e.g. "Let me check that for you.").
4. After the system responds with the actual slot list in the next message, **only** describe times that were listed. Never invent times or availability.

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

  // Google Places tools (only if place_id is configured)
  if (restaurant?.place_id) {
    prompt += `

## Google Places info
When the customer asks about the restaurant's address, location, opening hours, ratings, reviews, or wants to see photos:

- For details/reviews, output:
\`\`\`json
{"action":"place_details","include_reviews":true}
\`\`\`
Set include_reviews to false if they only asked about hours/address (not reviews).

- For photos, output:
\`\`\`json
{"action":"place_photos","max_photos":5}
\`\`\`

The system will fetch live data from Google and you'll get the result to summarise naturally.`;
  }

  return prompt;
}

const SYSTEM_PROMPT = buildSystemPrompt();

const AVAILABILITY_JSON_RE =
  /```json\s*(\{[\s\S]*?"action"\s*:\s*"availability"[\s\S]*?\})\s*```/;

const PLACE_DETAILS_JSON_RE =
  /```json\s*(\{[\s\S]*?"action"\s*:\s*"place_details"[\s\S]*?\})\s*```/;

const PLACE_PHOTOS_JSON_RE =
  /```json\s*(\{[\s\S]*?"action"\s*:\s*"place_photos"[\s\S]*?\})\s*```/;

function formatSlotsForPrompt(slots: TimeSlot[]): string {
  if (slots.length === 0) {
    return 'No bookable time slots were returned for this date and party size. Do not invent times — say nothing matched or suggest another date or calling the restaurant.';
  }
  return slots
    .map(s => `- ${s.time} — booking pace ${s.booked}/${s.capacity} (capacity ${s.capacity})`)
    .join('\n');
}

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

    let reply =
      (await provider.chat(history, SYSTEM_PROMPT)) || 'Sorry, I could not generate a response.';

    const availabilityMatch = reply.match(AVAILABILITY_JSON_RE);
    let availabilityLookup: ChatResponse['availabilityLookup'] | undefined;

    if (availabilityMatch) {
      try {
        const payload = JSON.parse(availabilityMatch[1]) as {
          action?: string;
          date?: string;
          partySize?: unknown;
        };
        if (payload.action === 'availability' && typeof payload.date === 'string' && payload.partySize != null) {
          const partySizeNum = Number(payload.partySize);
          const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(payload.date);
          const partyOk = Number.isFinite(partySizeNum) && partySizeNum >= 2 && partySizeNum <= 10;

          history.push({ role: 'assistant', content: reply });

          if (!dateOk || !partyOk) {
            history.push({
              role: 'user',
              content:
                '[System] Availability lookup rejected: date must be YYYY-MM-DD and party size must be 2–10. Ask the customer for a valid date and party size, then use the availability JSON again.',
            });
          } else {
            try {
              const slots = await getSevenRooms().getAvailability(payload.date, partySizeNum);
              availabilityLookup = {
                date: payload.date,
                partySize: partySizeNum,
                slotCount: slots.length,
              };
              history.push({
                role: 'user',
                content: `[Live availability from our reservation system for ${payload.date}, party of ${partySizeNum}:\n${formatSlotsForPrompt(
                  slots
                )}\n\nSummarize for the customer in a friendly way. Only mention times listed above. Do not repeat raw JSON.`,
              });
            } catch (err) {
              history.push({
                role: 'user',
                content: `[System could not load availability: ${(err as Error).message}. Apologize briefly and suggest they try again later or call the restaurant.]`,
              });
            }
          }

          reply =
            (await provider.chat(history, SYSTEM_PROMPT)) ||
            'Sorry, I could not generate a response.';
          history.push({ role: 'assistant', content: reply });
          logTranscript(sessionId, 'assistant', reply);
        } else {
          history.push({ role: 'assistant', content: reply });
          logTranscript(sessionId, 'assistant', reply);
        }
      } catch (e) {
        console.error('[chat] availability JSON parse failed:', e);
        history.push({ role: 'assistant', content: reply });
        logTranscript(sessionId, 'assistant', reply);
      }
    } else {
      history.push({ role: 'assistant', content: reply });
      logTranscript(sessionId, 'assistant', reply);
    }

    // --- Google Places: place_details ---
    const placeDetailsMatch = reply.match(PLACE_DETAILS_JSON_RE);
    if (placeDetailsMatch && restaurant?.place_id) {
      try {
        const payload = JSON.parse(placeDetailsMatch[1]) as { action?: string; include_reviews?: boolean };
        if (payload.action === 'place_details') {
          // Ensure assistant message is in history (may already be there from availability path)
          if (history[history.length - 1]?.content !== reply) {
            history.push({ role: 'assistant', content: reply });
          }
          const result = await getPlaceDetails(restaurant.place_id, payload.include_reviews ?? true);
          history.push({ role: 'user', content: `[Google Places data for our restaurant:\n${result}\n\nSummarise this naturally for the customer. Do not repeat raw data verbatim.]` });
          reply = (await provider.chat(history, SYSTEM_PROMPT)) || 'Sorry, I could not generate a response.';
          history.push({ role: 'assistant', content: reply });
          logTranscript(sessionId, 'assistant', reply);
        }
      } catch (e) {
        console.error('[chat] place_details parse/fetch failed:', e);
      }
    }

    // --- Google Places: place_photos ---
    const placePhotosMatch = reply.match(PLACE_PHOTOS_JSON_RE);
    if (placePhotosMatch && restaurant?.place_id) {
      try {
        const payload = JSON.parse(placePhotosMatch[1]) as { action?: string; max_photos?: number };
        if (payload.action === 'place_photos') {
          if (history[history.length - 1]?.content !== reply) {
            history.push({ role: 'assistant', content: reply });
          }
          const result = await getPlacePhotos(restaurant.place_id, payload.max_photos ?? 5);
          history.push({ role: 'user', content: `[Google Places photos for our restaurant:\n${result}\n\nShare these photo links with the customer in a friendly way.]` });
          reply = (await provider.chat(history, SYSTEM_PROMPT)) || 'Sorry, I could not generate a response.';
          history.push({ role: 'assistant', content: reply });
          logTranscript(sessionId, 'assistant', reply);
        }
      } catch (e) {
        console.error('[chat] place_photos parse/fetch failed:', e);
      }
    }

    // Check if the reply contains a booking action and execute it
    // Match booking JSON in code fences OR as raw JSON
    const bookingMatch = reply.match(
      /```json\s*\n?\s*(\{[^}]*"action"\s*:\s*"book"[^}]*\})\s*\n?\s*```/
    ) || reply.match(
      /(\{[^}]*"action"\s*:\s*"book"[^}]*\})/
    );
    if (bookingMatch) {
      try {
        const bookingData = JSON.parse(bookingMatch[1]);
        
        // Validate booking data
        if (bookingData.date && bookingData.time && bookingData.partySize && 
            bookingData.name && bookingData.email && bookingData.phone) {
          
          // Validate UK phone number before hitting SevenRooms
          // Strip to digits and remove leading +44/0044/0 to get bare number
          let barePhone = bookingData.phone.replace(/\D/g, '');
          if (barePhone.startsWith('44')) barePhone = barePhone.substring(2);
          else if (barePhone.startsWith('0')) barePhone = barePhone.substring(1);
          // UK mobile: 7xxx xxx xxx (10 digits starting with 7)
          // UK landline: 1xx/2xx/3xx (10 digits)
          const ukBareRegex = /^[1-37]\d{9}$/;
          if (!ukBareRegex.test(barePhone)) {
            console.log(`[chat] Invalid UK phone: ${bookingData.phone} (bare: ${barePhone})`);
            const phoneErrorMsg = `[System] The phone number "${bookingData.phone}" is not a valid UK phone number. Ask the customer for a valid UK mobile number (e.g. 7123 456789 or +44 7123 456789 or 07123 456789).`;
            history.push({ role: 'user', content: phoneErrorMsg });
            const phoneReply = await provider.chat(history, SYSTEM_PROMPT) ||
              `I'm sorry, but the phone number you provided doesn't appear to be a valid UK number. Could you please provide a UK mobile number? For example: 07123 456789 or +44 7123 456789.`;
            history.push({ role: 'assistant', content: phoneReply });
            return res.json({ reply: phoneReply });
          }
          
          console.log(`[chat] Auto-booking for ${bookingData.name} — ${bookingData.partySize} guests, ${bookingData.date} ${bookingData.time}`);
          
          try {
            // Call the SevenRooms booking API directly
            const bookingResult = await getSevenRooms().createBooking({
              date: bookingData.date,
              time: bookingData.time,
              partySize: Number(bookingData.partySize),
              name: bookingData.name,
              email: bookingData.email,
              phone: bookingData.phone,
              notes: bookingData.specialRequests || '',
            });
            
            if (bookingResult.success) {
              // Add booking confirmation to history
              const d = bookingResult.details || {};
              const detailLines = [
                `Reservation ID: ${bookingResult.reservationId}`,
                d.firstName || d.lastName ? `Guest: ${[d.firstName, d.lastName].filter(Boolean).join(' ')}` : null,
                d.venue ? `Venue: ${d.venue}` : null,
                d.date ? `Date: ${d.date}` : null,
                d.time ? `Time: ${d.time}` : null,
                d.partySize ? `Party size: ${d.partySize}` : null,
                d.phone ? `Phone: ${d.phone}` : null,
                d.email ? `Email: ${d.email}` : null,
              ].filter(Boolean).join(', ');
              const confirmationMsg = `[System] ✅ Booking confirmed! ${detailLines}. Tell the customer their reservation is confirmed and provide the details.`;
              history.push({ role: 'user', content: confirmationMsg });
              
              // Get updated reply with confirmation
              const confirmReply = await provider.chat(history, SYSTEM_PROMPT) || 
                `Great news! Your reservation is confirmed! 🎉\n\nReservation ID: ${bookingResult.reservationId}\nDate: ${bookingData.date}\nTime: ${bookingData.time}\nParty size: ${bookingData.partySize}\n\nSee you then!`;
              
              history.push({ role: 'assistant', content: confirmReply });
              logTranscript(sessionId, 'assistant', confirmReply);
              
              const out: ChatResponse = { reply: confirmReply };
              if (availabilityLookup) out.availabilityLookup = availabilityLookup;
              res.json(out);
              return;
            } else {
              // Booking failed
              const errorMsg = `[System] ❌ Booking failed: ${bookingResult.message}. Apologize and ask if they'd like to try a different time.`;
              history.push({ role: 'user', content: errorMsg });
              
              const errorReply = await provider.chat(history, SYSTEM_PROMPT) || 
                `I'm sorry, but I couldn't complete your reservation. ${bookingResult.message}. Would you like to try a different time?`;
              
              history.push({ role: 'assistant', content: errorReply });
              logTranscript(sessionId, 'assistant', errorReply);
              
              const out: ChatResponse = { reply: errorReply };
              if (availabilityLookup) out.availabilityLookup = availabilityLookup;
              res.json(out);
              return;
            }
          } catch (bookingErr) {
            console.error('[chat] Booking error:', bookingErr);
            const errorMsg = `[System] Booking system error: ${(bookingErr as Error).message}. Apologize and suggest calling the restaurant.`;
            history.push({ role: 'user', content: errorMsg });
            
            const errorReply = await provider.chat(history, SYSTEM_PROMPT) || 
              `I'm sorry, but I'm having trouble with the booking system right now. Please call us directly to make your reservation.`;
            
            history.push({ role: 'assistant', content: errorReply });
            logTranscript(sessionId, 'assistant', errorReply);
            
            const out: ChatResponse = { reply: errorReply };
            if (availabilityLookup) out.availabilityLookup = availabilityLookup;
            res.json(out);
            return;
          }
        }
      } catch {
        // JSON parse failed — just return the reply normally
      }
    }

    const out: ChatResponse = { reply };
    if (availabilityLookup) out.availabilityLookup = availabilityLookup;
    res.json(out);
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

    // Validate UK phone number
    let barePhone = phone.replace(/\D/g, '');
    if (barePhone.startsWith('44')) barePhone = barePhone.substring(2);
    else if (barePhone.startsWith('0')) barePhone = barePhone.substring(1);
    const ukBareRegex = /^[1-37]\d{9}$/;
    if (!ukBareRegex.test(barePhone)) {
      res.status(400).json({ error: `Invalid UK phone number: ${phone}. Please provide a valid UK mobile (e.g. 07123 456789 or +44 7123 456789).` });
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

  // Start SevenRooms cookie keepalive (random interval 15-45 min)
  if (process.env.SEVENROOMS_EMAIL) {
    getSevenRooms().startKeepAlive(15, 45);
  }
});
