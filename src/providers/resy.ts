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

      // 1. Party size — Resy uses a dropdown/stepper
      const partySet = await this.selectByLabel(
        page,
        [/seats?/i, /party\s*size/i, /guests?/i, /people/i],
        ['select[name="party_size"]'],
        String(details.partySize),
      );
      if (!partySet) {
        // Resy sometimes uses a button that opens a list
        const partyBtn = await this.findFirst([
          page.getByRole('button', { name: /seats?/i }),
          page.getByRole('button', { name: /party/i }),
          page.getByRole('button', { name: /guest/i }),
        ]);
        if (partyBtn) {
          await partyBtn.click();
          // Pick the number from the dropdown list
          const option = page.getByRole('option', { name: String(details.partySize) });
          if ((await option.count()) > 0) {
            await option.first().click();
          } else {
            // Fallback: list items
            const li = page.locator(`li:has-text("${details.partySize}"), [data-value="${details.partySize}"]`).first();
            if ((await li.count()) > 0) await li.click();
          }
        }
      }

      // 2. Date — Resy typically uses a calendar widget
      const dateBtn = await this.findFirst([
        page.getByRole('button', { name: /date/i }),
        page.getByLabel(/date/i),
      ]);
      if (dateBtn) {
        await dateBtn.click();
        const [, , day] = details.date.split('-');
        const dayNum = parseInt(day, 10);
        // Try aria grid cell first (standard calendar), then button/td
        const dayCell = await this.findFirst([
          page.getByRole('gridcell', { name: String(dayNum) }),
          page.getByRole('button', { name: String(dayNum) }),
          page.locator(`td:has-text("${dayNum}")`).first() as any,
        ]);
        if (dayCell) await dayCell.click();
      } else {
        // Some Resy embeds accept direct date input
        await this.fillByLabel(
          page,
          [/date/i],
          ['input[type="date"]'],
          details.date,
        );
      }

      // 3. Pick a time slot
      await page.waitForTimeout(2000); // let slots render
      const timeSlot = page.getByRole('button', { name: details.time });
      if ((await timeSlot.count()) > 0) {
        await timeSlot.first().click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      }

      // 4. Click reserve / book now
      await this.clickButton(
        page,
        [/reserve/i, /book\s*(now)?/i, /confirm/i],
      );
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // 5. Fill guest info
      const [firstName, ...lastParts] = details.name.split(' ');
      const lastName = lastParts.join(' ') || details.name;

      await this.fillByLabel(page, [/first\s*name/i], ['input[name="first_name"]'], firstName);
      await this.fillByLabel(page, [/last\s*name/i, /surname/i], ['input[name="last_name"]'], lastName);
      await this.fillByLabel(page, [/email/i], ['input[name="email"]', 'input[type="email"]'], details.email);
      await this.fillByLabel(page, [/phone/i, /mobile/i], ['input[name="mobile_number"]', 'input[type="tel"]'], details.phone);

      if (details.specialRequests) {
        await this.fillByLabel(
          page,
          [/special\s*request/i, /note/i, /dietary/i, /allerg/i],
          ['textarea', 'input[name="special_requests"]'],
          details.specialRequests,
        );
      }

      // 6. Final confirm
      await this.clickButton(
        page,
        [/confirm/i, /complete/i, /submit/i],
        ['button[type="submit"]'],
      );
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

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
