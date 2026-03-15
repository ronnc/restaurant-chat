/**
 * BookingProvider — abstract base for browser-driven restaurant booking.
 *
 * Every concrete provider must implement `canHandle()` and `book()`.
 */

import type { Page } from 'playwright';
import type { BookingDetails, BookingResult, IBookingProvider } from '../types.js';

export abstract class BookingProvider implements IBookingProvider {
  abstract name: string;

  abstract canHandle(url: string): boolean;

  abstract book(page: Page, details: BookingDetails): Promise<BookingResult>;

  /** Helper: fill a field if it exists on the page. */
  protected async fillField(page: Page, selector: string, value: string): Promise<void> {
    const el = page.locator(selector).first();
    if ((await el.count()) > 0) {
      await el.click();
      await el.fill(value);
    }
  }

  /** Helper: extract confirmation info from page body text. */
  protected async extractConfirmation(page: Page): Promise<{ code: string | null; message: string | null }> {
    const text = await page.textContent('body');
    const codeMatch = text?.match(/confirmation[:\s#]*([A-Z0-9-]+)/i);
    const hasConfirm = /confirmed|thank you|reservation.*(made|booked|complete|set)/i.test(text || '');
    return {
      code: codeMatch?.[1] || null,
      message: hasConfirm ? 'Reservation confirmed!' : null,
    };
  }
}
