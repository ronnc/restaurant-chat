/**
 * BookingProvider — abstract base for browser-driven restaurant booking.
 *
 * Every concrete provider must implement `canHandle()` and `book()`.
 */

import type { Page, Locator } from 'playwright';
import type { BookingDetails, BookingResult, IBookingProvider } from '../types.js';

export abstract class BookingProvider implements IBookingProvider {
  abstract name: string;

  abstract canHandle(url: string): boolean;

  abstract book(page: Page, details: BookingDetails): Promise<BookingResult>;

  // ---------------------------------------------------------------------------
  // Semantic (aria) locator helpers
  // ---------------------------------------------------------------------------

  /**
   * Try a series of aria/role locators in order. Returns the first one that
   * exists on the page, or null if none match.
   */
  protected async findFirst(locators: Locator[]): Promise<Locator | null> {
    for (const loc of locators) {
      if ((await loc.count()) > 0) return loc.first();
    }
    return null;
  }

  /** Fill a field using semantic locators, falling back to CSS selector. */
  protected async fillField(page: Page, selector: string, value: string): Promise<void> {
    const el = page.locator(selector).first();
    if ((await el.count()) > 0) {
      await el.click();
      await el.fill(value);
    }
  }

  /** Fill a field by role/label first, then fall back to CSS selectors. */
  protected async fillByLabel(
    page: Page,
    labelPatterns: RegExp[],
    cssFallbacks: string[],
    value: string,
  ): Promise<boolean> {
    // Try getByLabel first (most semantic)
    for (const pat of labelPatterns) {
      const loc = page.getByLabel(pat);
      if ((await loc.count()) > 0) {
        await loc.first().click();
        await loc.first().fill(value);
        return true;
      }
    }
    // Try getByPlaceholder
    for (const pat of labelPatterns) {
      const loc = page.getByPlaceholder(pat);
      if ((await loc.count()) > 0) {
        await loc.first().click();
        await loc.first().fill(value);
        return true;
      }
    }
    // CSS fallback
    for (const sel of cssFallbacks) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        await loc.click();
        await loc.fill(value);
        return true;
      }
    }
    return false;
  }

  /** Click the first matching button by accessible text patterns, then CSS fallback. */
  protected async clickButton(
    page: Page,
    textPatterns: RegExp[],
    cssFallbacks: string[] = [],
  ): Promise<boolean> {
    for (const pat of textPatterns) {
      const loc = page.getByRole('button', { name: pat });
      if ((await loc.count()) > 0) {
        await loc.first().click();
        return true;
      }
    }
    // Also try links styled as buttons
    for (const pat of textPatterns) {
      const loc = page.getByRole('link', { name: pat });
      if ((await loc.count()) > 0) {
        await loc.first().click();
        return true;
      }
    }
    for (const sel of cssFallbacks) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        await loc.click();
        return true;
      }
    }
    return false;
  }

  /** Select from a combobox/select by role, falling back to CSS. */
  protected async selectByLabel(
    page: Page,
    labelPatterns: RegExp[],
    cssFallbacks: string[],
    value: string,
  ): Promise<boolean> {
    for (const pat of labelPatterns) {
      const loc = page.getByLabel(pat);
      if ((await loc.count()) > 0) {
        await loc.first().selectOption(value);
        return true;
      }
    }
    for (const sel of cssFallbacks) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0) {
        await loc.selectOption(value);
        return true;
      }
    }
    return false;
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
