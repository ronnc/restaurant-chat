import type { Page } from 'playwright';
import { BookingProvider } from './base.js';
import type { BookingDetails, BookingResult } from '../types.js';

export class ResyProvider extends BookingProvider {
  name = 'Resy';

  canHandle(url: string): boolean {
    return /resy\.com/i.test(url);
  }

  async book(page: Page, details: BookingDetails): Promise<BookingResult> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // 1. Party size — Resy usually has a dropdown or stepper
      const partySel = page.locator(
        'button[data-test="seats"], [aria-label*="Seats"], [aria-label*="party"]'
      ).first();
      if ((await partySel.count()) > 0) {
        await partySel.click();
        const option = page.locator(
          `li:has-text("${details.partySize}"), [data-value="${details.partySize}"]`
        ).first();
        if ((await option.count()) > 0) await option.click();
      } else {
        const select = page.locator('select[name="party_size"]').first();
        if ((await select.count()) > 0) await select.selectOption(String(details.partySize));
      }

      // 2. Date — Resy uses a calendar widget
      const dateBtn = page.locator('button[data-test="date-picker"], [aria-label*="Date"]').first();
      if ((await dateBtn.count()) > 0) {
        await dateBtn.click();
        const [, , day] = details.date.split('-');
        const dayNum = parseInt(day, 10);
        const dayCell = page.locator(`button:has-text("${dayNum}"), td:has-text("${dayNum}")`).first();
        if ((await dayCell.count()) > 0) await dayCell.click();
      }

      // 3. Pick a time slot
      await page.waitForTimeout(2000);
      const timeSlot = page.locator(
        `button:has-text("${details.time}"), [data-time="${details.time}"]`
      ).first();
      if ((await timeSlot.count()) > 0) {
        await timeSlot.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 4. Click reserve / book now
      const reserveBtn = page.locator(
        'button:has-text("Reserve"), button:has-text("Book"), button:has-text("Confirm")'
      ).first();
      if ((await reserveBtn.count()) > 0) {
        await reserveBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 5. Fill guest info
      const [firstName, ...lastParts] = details.name.split(' ');
      const lastName = lastParts.join(' ') || details.name;
      await this.fillField(page, 'input[name="first_name"], input[placeholder*="First"]', firstName);
      await this.fillField(page, 'input[name="last_name"], input[placeholder*="Last"]', lastName);
      await this.fillField(page, 'input[name="email"], input[type="email"]', details.email);
      await this.fillField(page, 'input[name="mobile_number"], input[type="tel"]', details.phone);

      if (details.specialRequests) {
        await this.fillField(page, 'textarea, input[name="special_requests"]', details.specialRequests);
      }

      // 6. Final confirm
      const confirmBtn = page.locator(
        'button:has-text("Confirm"), button:has-text("Complete"), button[type="submit"]'
      ).first();
      if ((await confirmBtn.count()) > 0) {
        await confirmBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      }

      const confirmation = await this.extractConfirmation(page);

      return {
        success: true,
        confirmationCode: confirmation.code || undefined,
        message:
          confirmation.message ||
          `Booking submitted via Resy for ${details.partySize} guests on ${details.date} at ${details.time}.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `Resy booking failed: ${(err as Error).message}`,
      };
    }
  }
}
