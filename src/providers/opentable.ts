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
      const partySet = await this.selectByLabel(
        page,
        [/party\s*size/i, /guests?/i, /people/i, /diners?/i, /covers?/i],
        ['select[data-test="select-party-size"]', 'select#covers'],
        String(details.partySize),
      );
      if (!partySet) {
        const btn = page.locator(`button[data-party-size="${details.partySize}"]`).first();
        if ((await btn.count()) > 0) await btn.click();
      }

      // 2. Date
      await this.fillByLabel(
        page,
        [/date/i, /when/i],
        ['input[data-test="date-picker"]', 'input[type="date"]'],
        details.date,
      );

      // 3. Time
      await this.selectByLabel(
        page,
        [/time/i],
        ['select[data-test="time-picker"]', 'select#time'],
        details.time,
      );

      // 4. Find a table
      await this.clickButton(
        page,
        [/find\s*a?\s*table/i, /find/i, /search/i],
        ['button[data-test="find-a-table"]'],
      );
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // 5. Pick time slot
      const slot = page.getByRole('button', { name: details.time });
      if ((await slot.count()) > 0) {
        await slot.first().click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }

      // 6. Fill diner info
      const [firstName, ...lastParts] = details.name.split(' ');
      const lastName = lastParts.join(' ') || details.name;

      await this.fillByLabel(page, [/first\s*name/i], ['input[name="firstName"]', 'input[data-test="first-name"]'], firstName);
      await this.fillByLabel(page, [/last\s*name/i, /surname/i], ['input[name="lastName"]', 'input[data-test="last-name"]'], lastName);
      await this.fillByLabel(page, [/email/i], ['input[name="email"]', 'input[data-test="email"]'], details.email);
      await this.fillByLabel(page, [/phone/i, /mobile/i], ['input[name="phone"]', 'input[data-test="phone-number"]'], details.phone);

      if (details.specialRequests) {
        await this.fillByLabel(
          page,
          [/special\s*request/i, /note/i, /occasion/i],
          ['textarea[name="specialRequest"]', 'textarea[data-test="special-request"]'],
          details.specialRequests,
        );
      }

      // 7. Complete reservation
      await this.clickButton(
        page,
        [/complete\s*reserv/i, /confirm/i],
        ['button[data-test="complete-reservation"]'],
      );
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

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
