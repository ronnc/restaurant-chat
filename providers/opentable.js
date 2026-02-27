import { BookingProvider } from './base.js';

export class OpenTableProvider extends BookingProvider {
  name = 'OpenTable';

  canHandle(url) {
    return /opentable\.com/i.test(url);
  }

  async book(page, details) {
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // 1. Party size
      const partyPicker = page.locator('select[data-test="select-party-size"], select#covers, [aria-label*="party size"] select').first();
      if (await partyPicker.count() > 0) {
        await partyPicker.selectOption(String(details.partySize));
      } else {
        const partyBtn = page.locator(`button[data-party-size="${details.partySize}"]`).first();
        if (await partyBtn.count() > 0) await partyBtn.click();
      }

      // 2. Date
      const dateInput = page.locator('input[data-test="date-picker"], input[type="date"], input[aria-label*="Date"]').first();
      if (await dateInput.count() > 0) {
        await dateInput.click();
        await dateInput.fill(details.date);
      }

      // 3. Time
      const timePicker = page.locator('select[data-test="time-picker"], select#time, [aria-label*="Time"] select').first();
      if (await timePicker.count() > 0) {
        await timePicker.selectOption(details.time);
      }

      // 4. Find a table
      const findBtn = page.locator('button:has-text("Find"), button:has-text("Search"), button[data-test="find-a-table"]').first();
      if (await findBtn.count() > 0) {
        await findBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 5. Pick time slot
      const slot = page.locator(`button:has-text("${details.time}"), [data-time="${details.time}"]`).first();
      if (await slot.count() > 0) {
        await slot.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 6. Fill diner info
      await this._fillField(page, 'input[name="firstName"], input[data-test="first-name"]', details.name.split(' ')[0]);
      await this._fillField(page, 'input[name="lastName"], input[data-test="last-name"]', details.name.split(' ').slice(1).join(' ') || details.name);
      await this._fillField(page, 'input[name="email"], input[data-test="email"]', details.email);
      await this._fillField(page, 'input[name="phone"], input[data-test="phone-number"]', details.phone);

      if (details.specialRequests) {
        await this._fillField(page, 'textarea[name="specialRequest"], textarea[data-test="special-request"]', details.specialRequests);
      }

      // 7. Complete reservation
      const completeBtn = page.locator('button:has-text("Complete"), button:has-text("Confirm"), button[data-test="complete-reservation"]').first();
      if (await completeBtn.count() > 0) {
        await completeBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      }

      // 8. Extract confirmation
      const confirmation = await this._extractConfirmation(page);

      return {
        success: true,
        confirmationCode: confirmation.code || undefined,
        message: confirmation.message || `Booking submitted via OpenTable for ${details.partySize} guests on ${details.date} at ${details.time}.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `OpenTable booking failed: ${err.message}`,
      };
    }
  }

  async _fillField(page, selector, value) {
    const el = page.locator(selector).first();
    if (await el.count() > 0) {
      await el.click();
      await el.fill(value);
    }
  }

  async _extractConfirmation(page) {
    const text = await page.textContent('body');
    const codeMatch = text.match(/confirmation[:\s#]*([A-Z0-9-]+)/i);
    const hasConfirm = /confirmed|thank you|reservation.*(complete|booked)/i.test(text);
    return {
      code: codeMatch?.[1] || null,
      message: hasConfirm ? 'Reservation confirmed!' : null,
    };
  }
}
