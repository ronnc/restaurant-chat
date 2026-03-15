/**
 * Booking orchestrator — detects platform, launches browser, delegates to provider.
 */
import { chromium } from 'playwright';
import { SevenRoomsProvider } from './providers/sevenrooms.js';
import { OpenTableProvider } from './providers/opentable.js';
import { ResyProvider } from './providers/resy.js';
import type { BookingDetails, BookingResult, IBookingProvider } from './types.js';

const providers: IBookingProvider[] = [
  new SevenRoomsProvider(),
  new OpenTableProvider(),
  new ResyProvider(),
];

/**
 * Detect which provider handles a given booking URL.
 */
export function detectProvider(url: string): IBookingProvider | null {
  for (const p of providers) {
    if (p.canHandle(url)) return p;
  }
  return null;
}

/**
 * Execute a booking end-to-end.
 */
export async function makeBooking(details: BookingDetails): Promise<BookingResult> {
  const { bookingUrl } = details;
  if (!bookingUrl) {
    return { success: false, message: 'No booking URL provided.' };
  }

  const provider = detectProvider(bookingUrl);
  if (!provider) {
    return {
      success: false,
      message: `No booking provider found for URL: ${bookingUrl}. Supported platforms: SevenRooms, OpenTable, Resy.`,
    };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(bookingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log(`[booking] Using ${provider.name} for ${bookingUrl}`);
    const result = await provider.book(page, details);
    return result;
  } catch (err) {
    return {
      success: false,
      message: `Booking error (${provider?.name || 'unknown'}): ${(err as Error).message}`,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
