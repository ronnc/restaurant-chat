import type { Page } from 'playwright';
import { BookingProvider } from './base.js';
import type { BookingDetails, BookingResult } from '../types.js';

export class SevenRoomsProvider extends BookingProvider {
  name = 'SevenRooms';

  canHandle(url: string): boolean {
    return /sevenrooms\.com\/reservations\//i.test(url);
  }

  async book(page: Page, details: BookingDetails): Promise<BookingResult> {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // 1. Select party size — try semantic, then CSS
      const partySizeSet = await this.selectByLabel(
        page,
        [/party\s*size/i, /guests?/i, /people/i, /covers?/i],
        [
          '[data-test="party-size-picker"]',
          'select[name="party_size"]',
          '.party-size-select',
          '#party_size',
        ],
        String(details.partySize),
      );
      if (!partySizeSet) {
        // Some widgets use buttons instead of a select
        const btn = page.getByRole('button', { name: String(details.partySize) });
        if ((await btn.count()) > 0) await btn.first().click();
      }

      // 2. Select date
      await this.fillByLabel(
        page,
        [/date/i, /when/i, /reservation date/i],
        [
          'input[type="date"]',
          'input[name="date"]',
          '[data-test="date-picker"]',
          '.date-picker input',
        ],
        details.date,
      );

      // 3. Select time
      const timeSet = await this.selectByLabel(
        page,
        [/time/i, /reservation time/i],
        [
          'select[name="time"]',
          '[data-test="time-picker"]',
          '.time-picker select',
        ],
        details.time,
      );
      if (!timeSet) {
        // Try clicking a time button
        const timeBtn = page.getByRole('button', { name: details.time });
        if ((await timeBtn.count()) > 0) await timeBtn.first().click();
      }

      // 4. Click search / find availability
      await this.clickButton(
        page,
        [/find/i, /search/i, /check\s*availab/i, /see\s*availab/i],
        ['button[type="submit"]'],
      );
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // 5. Select a time slot if results are presented
      const timeSlot = page.getByRole('button', { name: details.time });
      if ((await timeSlot.count()) > 0) {
        await timeSlot.first().click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }

      // 6. Fill guest details
      const [firstName, ...lastParts] = details.name.split(' ');
      const lastName = lastParts.join(' ') || details.name;

      await this.fillByLabel(
        page,
        [/first\s*name/i],
        ['input[name="first_name"]'],
        firstName,
      );
      await this.fillByLabel(
        page,
        [/last\s*name/i, /surname/i],
        ['input[name="last_name"]'],
        lastName,
      );
      await this.fillByLabel(
        page,
        [/email/i],
        ['input[name="email"]', 'input[type="email"]'],
        details.email,
      );
      await this.fillByLabel(
        page,
        [/phone/i, /mobile/i, /tel/i],
        ['input[name="phone"]', 'input[type="tel"]'],
        details.phone,
      );

      if (details.specialRequests) {
        await this.fillByLabel(
          page,
          [/special\s*request/i, /note/i, /comment/i, /dietary/i],
          ['textarea[name="notes"]', 'textarea[name="special_requests"]', 'textarea'],
          details.specialRequests,
        );
      }

      // 7. Submit reservation
      await this.clickButton(
        page,
        [/complete\s*reserv/i, /confirm/i, /book\s*(now|reserv)?/i, /submit/i],
        ['button[type="submit"]'],
      );
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // 8. Check for confirmation
      const confirmation = await this.extractConfirmation(page);

      return {
        success: true,
        confirmationCode: confirmation.code || undefined,
        message:
          confirmation.message ||
          `Booking submitted via SevenRooms for ${details.partySize} guests on ${details.date} at ${details.time}.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `SevenRooms booking failed: ${(err as Error).message}`,
      };
    }
  }
}
