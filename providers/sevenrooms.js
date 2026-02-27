import { BookingProvider } from './base.js';

export class SevenRoomsProvider extends BookingProvider {
  name = 'SevenRooms';

  canHandle(url) {
    return /sevenrooms\.com\/reservations\//i.test(url);
  }

  async book(page, details) {
    try {
      // Wait for the widget to load
      await page.waitForLoadState('networkidle', { timeout: 15000 });

      // 1. Select party size
      const partySizeSelector = page.locator('[data-test="party-size-picker"], select[name="party_size"], .party-size-select, #party_size');
      if (await partySizeSelector.count() > 0) {
        await partySizeSelector.first().selectOption(String(details.partySize));
      } else {
        // Try clicking a party-size button
        const btn = page.locator(`button:has-text("${details.partySize}")`).first();
        if (await btn.count() > 0) await btn.click();
      }

      // 2. Select date
      const dateInput = page.locator('input[type="date"], input[name="date"], [data-test="date-picker"]').first();
      if (await dateInput.count() > 0) {
        await dateInput.fill(details.date);
      } else {
        // Try the date picker text input
        const dateText = page.locator('.date-picker input, input[placeholder*="Date"]').first();
        if (await dateText.count() > 0) {
          await dateText.click();
          await dateText.fill(details.date);
        }
      }

      // 3. Select time
      const timeSelect = page.locator('select[name="time"], [data-test="time-picker"], .time-picker select').first();
      if (await timeSelect.count() > 0) {
        await timeSelect.selectOption(details.time);
      } else {
        const timeBtn = page.locator(`button:has-text("${details.time}"), [data-time="${details.time}"]`).first();
        if (await timeBtn.count() > 0) await timeBtn.click();
      }

      // 4. Click search/find availability
      const searchBtn = page.locator('button:has-text("Find"), button:has-text("Search"), button[type="submit"]').first();
      if (await searchBtn.count() > 0) {
        await searchBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 5. Select a time slot if presented
      const timeSlot = page.locator(`[data-time="${details.time}"], button:has-text("${details.time}")`).first();
      if (await timeSlot.count() > 0) {
        await timeSlot.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      }

      // 6. Fill guest details
      await this._fillField(page, 'input[name="first_name"], input[placeholder*="First"]', details.name.split(' ')[0]);
      await this._fillField(page, 'input[name="last_name"], input[placeholder*="Last"]', details.name.split(' ').slice(1).join(' ') || details.name);
      await this._fillField(page, 'input[name="email"], input[type="email"]', details.email);
      await this._fillField(page, 'input[name="phone"], input[type="tel"]', details.phone);

      if (details.specialRequests) {
        await this._fillField(page, 'textarea[name="notes"], textarea[name="special_requests"], textarea', details.specialRequests);
      }

      // 7. Submit
      const submitBtn = page.locator('button:has-text("Complete"), button:has-text("Confirm"), button:has-text("Book"), button[type="submit"]').first();
      if (await submitBtn.count() > 0) {
        await submitBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      }

      // 8. Check for confirmation
      const confirmation = await this._extractConfirmation(page);

      return {
        success: true,
        confirmationCode: confirmation.code || undefined,
        message: confirmation.message || `Booking submitted via SevenRooms for ${details.partySize} guests on ${details.date} at ${details.time}.`,
      };
    } catch (err) {
      return {
        success: false,
        message: `SevenRooms booking failed: ${err.message}`,
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
    const hasConfirm = /confirmed|thank you|reservation.*(made|booked)/i.test(text);
    return {
      code: codeMatch?.[1] || null,
      message: hasConfirm ? 'Reservation confirmed!' : null,
    };
  }
}
