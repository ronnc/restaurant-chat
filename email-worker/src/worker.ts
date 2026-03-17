/**
 * Cloudflare Email Worker for SevenRooms 2FA code extraction.
 *
 * Receives inbound email to booking@chaifamily.com.au,
 * extracts the 2FA/verification code, and stores it in KV.
 * Exposes an HTTP endpoint to retrieve the latest code.
 */

export interface Env {
  CODES: KVNamespace;
  API_KEY: string;
  FORWARD_TO: string; // email address to forward all emails to
}

// Extract verification/2FA code from email body
function extractCode(text: string): string | null {
  // Common patterns: 6-digit codes, sometimes 4-8 digits
  // SevenRooms typically sends "Your verification code is: 123456"
  const patterns = [
    /verification\s*code\s*(?:is)?[:\s]*(\d{4,8})/i,
    /security\s*code\s*(?:is)?[:\s]*(\d{4,8})/i,
    /one[- ]time\s*(?:pass)?code\s*(?:is)?[:\s]*(\d{4,8})/i,
    /OTP\s*(?:is)?[:\s]*(\d{4,8})/i,
    /code\s*(?:is)?[:\s]*(\d{4,8})/i,
    /\b(\d{6})\b/,  // fallback: any standalone 6-digit number
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Convert ReadableStream to string
async function streamToText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(combined);
}

export default {
  // Handle inbound email
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const from = message.from;
    const to = message.to;
    const subject = message.headers.get('subject') || '';

    console.log(`📧 Email from: ${from}, to: ${to}, subject: ${subject}`);

    // Read the raw email body
    const rawBody = await streamToText(message.raw);

    // Try to extract code from subject first, then body
    let code = extractCode(subject) || extractCode(rawBody);

    if (code) {
      console.log(`🔑 Extracted 2FA code: ${code}`);

      // Store in KV with 10-minute TTL
      await env.CODES.put('latest_code', JSON.stringify({
        code,
        from,
        subject,
        timestamp: Date.now(),
      }), { expirationTtl: 600 });
    }

    // Forward email to Gmail
    if (env.FORWARD_TO) {
      try {
        await message.forward(env.FORWARD_TO);
        console.log(`📨 Forwarded to ${env.FORWARD_TO}`);
      } catch (e) {
        console.error(`❌ Forward failed: ${e}`);
      }
    }

    if (!code) {
      console.log('⚠️ No 2FA code found in email');

      // Store the raw email for debugging
      await env.CODES.put('latest_raw', JSON.stringify({
        from,
        subject,
        bodySnippet: rawBody.substring(0, 2000),
        timestamp: Date.now(),
      }), { expirationTtl: 600 });
    }
  },

  // HTTP endpoint to retrieve the latest code
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Simple API key auth
    const apiKey = url.searchParams.get('key') || request.headers.get('x-api-key');
    if (apiKey !== env.API_KEY) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/code') {
      const data = await env.CODES.get('latest_code');
      if (!data) {
        return new Response(JSON.stringify({ code: null, message: 'no code available' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(data, {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/raw') {
      const data = await env.CODES.get('latest_raw');
      return new Response(data || '{}', {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  },
};
