import type { Page } from 'playwright';
import { BookingProvider } from './base.js';
import type { BookingDetails, BookingResult } from '../types.js';

export class OpenTableProvider extends BookingProvider {
  name = 'OpenTable';

  canHandle(url: string): boolean {
    return /opentable\.com/i.test(url);
  }

  async book(page: Page, details: BookingDetails): Promise<BookingResult> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // 1. Party size
      const partyPicker = page.locator(
        'select[data-test="select-party-size"], select#covers, [aria-label*="party size"] select'
      ).first();
      if ((await partyPicker.count()) > 0) {
        await partyPicker.selectOption(String(details.partySize));
      } else {
        const partyBtn = page.locator(`button[data-party-size="${details.partySize}"]`).first();
        if ((await partyBtn.count()) > 0) await partyBtn.click();
      }

      // 2. Date
      const dateInput = page.locator(
        'input[data-test="date-picker"], input[type="date"], input[aria-label*="Date"]'
      ).first();
      if ((await dateInput.count()) > 0) {
        await dateInput.click();
        await dateInput.fill(details.date);
      }

      // 3. Time
      const timePicker = page.locator(
        'select[data-test="time-picker"], select#time, [aria-label*="Time"] select'
      ).first();
      if ((await timePicker.count()) > 0) {
        await timePicker.selectOption(details.time);
      }

      // 4. Find a table
      const findBtn = page.locator(
        'button:has-text("Find"), button:has-text("Search"), button[data-test="find-a-table"]'
      ).first();
      if ((await findBtn.count()) > 0) {
        await findBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 5. Pick time slot
      const slot = page.locator(
        `button:has-text("${details.time}"), [data-time="${details.time}"]`
      ).first();
      if ((await slot.count()) > 0) {
        await slot.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 6. Fill diner info
      const [firstName, ...lastParts] = details.name.split(' ');
      const lastName = lastParts.join(' ') || details.name;
      await this.fillField(page, 'input[name="firstName"], input[data-test="first-name"]', firstName);
      await this.fillField(page, 'input[name="lastName"], input[data-test="last-name"]', lastName);
      await this.fillField(page, 'input[name="email"], input[data-test="email"]', details.email);
      await this.fillField(page, 'input[name="phone"], input[data-test="phone-number"]', details.phone);

      if (details.specialRequests) {
        await this.fillField(
          page,
          'textarea[name="specialRequest"], textarea[data-test="special-request"]',
          details.specialRequests
        );
      }

      // 7. Complete reservation
      const completeBtn = page.locator(
        'button:has-text("Complete"), button:has-text("Confirm"), button[data-test="complete-reservation"]'
      ).first();
      if ((await completeBtn.count()) > 0) {
        await completeBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      }

      // 8. Extract confirmation
      const confirmation = await this.extractConfirmation(page);

      return {
        success: true,
        confirmationCode: confirmation.code || undefined,
        message:
          confirmation.message ||
          `Booking submitted via OpenTable for ${details.partySize} guests on ${details.date} at ${details.time}.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `OpenTable booking failed: ${(err as Error).message}`,
      };
    }
  }
}
