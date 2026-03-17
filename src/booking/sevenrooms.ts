/**
 * SevenRooms browser automation via Playwright.
 *
 * Manages a persistent browser session for the SevenRooms manager dashboard.
 * Handles login, availability checks, and reservation creation.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

const VENUE_SLUG = 'mydelhisunderland';
const BASE_URL = 'https://www.sevenrooms.com';
const LOGIN_URL = `${BASE_URL}/login`;
const MANAGER_BASE = `${BASE_URL}/manager/${VENUE_SLUG}`;
const NAV_TIMEOUT = 30_000;

export interface TimeSlot {
  time: string;
  booked: number;
  capacity: number;
}

export interface BookingRequest {
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM (24h)
  partySize: number;
  name: string;
  phone: string;
  email: string;
  notes?: string;
}

export interface BookingResult {
  success: boolean;
  reservationId?: string;
  message: string;
}

export interface ReservationStatus {
  reservationId: string;
  status: string;
  date?: string;
  time?: string;
  partySize?: number;
  guestName?: string;
}

function formatDateForUrl(date: string): string {
  // YYYY-MM-DD → MM-DD-YYYY
  const [y, m, d] = date.split('-');
  return `${m}-${d}-${y}`;
}

function formatDateForPicker(date: string): string {
  // YYYY-MM-DD → MM/DD/YYYY (SevenRooms date picker format)
  const [y, m, d] = date.split('-');
  return `${m}/${d}/${y}`;
}

function log(msg: string) {
  console.log(`[sevenrooms] ${new Date().toISOString()} ${msg}`);
}

export class SevenRoomsAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private loggedIn = false;

  private get headless(): boolean {
    return process.env.BROWSER_HEADLESS !== 'false';
  }

  private get email(): string {
    const v = process.env.SEVENROOMS_EMAIL;
    if (!v) throw new Error('SEVENROOMS_EMAIL env var not set');
    return v;
  }

  private get password(): string {
    const v = process.env.SEVENROOMS_PASSWORD;
    if (!v) throw new Error('SEVENROOMS_PASSWORD env var not set');
    return v;
  }

  /** Launch browser if not already running. */
  private async ensureBrowser(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    log('Launching browser...');
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(NAV_TIMEOUT);
    this.loggedIn = false;
    return this.page;
  }

  /** Login to SevenRooms. */
  async login(): Promise<void> {
    const page = await this.ensureBrowser();
    log('Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

    // Fill credentials
    await page.fill('input[name="email"], input[type="email"]', this.email);
    await page.fill('input[name="password"], input[type="password"]', this.password);

    // Click login button
    await page.click('button[type="submit"], button:has-text("Log In"), button:has-text("Sign In")');

    // Check if 2FA is required
    log('Checking for 2FA prompt...');
    const needs2FA = await Promise.race([
      page.waitForURL(`**/manager/**`, { timeout: 15_000 }).then(() => false),
      page.waitForSelector('input[name="code"], input[placeholder*="code"], input[placeholder*="Code"], input[type="tel"], input[inputmode="numeric"]', { timeout: 15_000 }).then(() => true),
    ]).catch(() => false);

    if (needs2FA) {
      log('2FA required — polling for code...');
      const code = await this.poll2FACode();
      if (!code) throw new Error('Failed to retrieve 2FA code within timeout');

      log(`Entering 2FA code: ${code}`);
      await page.fill('input[name="code"], input[placeholder*="code"], input[placeholder*="Code"], input[type="tel"], input[inputmode="numeric"]', code);

      // Submit the 2FA form
      const submitBtn = await page.$('button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm")');
      if (submitBtn) await submitBtn.click();

      // Wait for dashboard
      await page.waitForURL(`**/manager/**`, { timeout: NAV_TIMEOUT });
    }

    this.loggedIn = true;
    log('Login successful');
  }

  /** Poll the 2FA worker for a verification code. */
  private async poll2FACode(maxWaitMs = 120_000, intervalMs = 3_000): Promise<string | null> {
    const apiUrl = process.env.SEVENROOMS_2FA_URL;
    const apiKey = process.env.SEVENROOMS_2FA_KEY;
    if (!apiUrl || !apiKey) throw new Error('SEVENROOMS_2FA_URL and SEVENROOMS_2FA_KEY must be set');

    const startTime = Date.now();
    const startTimestamp = startTime - 5_000; // codes from 5s before login attempt

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const res = await fetch(`${apiUrl}/code?key=${apiKey}`);
        if (res.ok) {
          const data = await res.json() as { code: string | null; timestamp?: number };
          // Only accept codes that arrived after we started the login
          if (data.code && data.timestamp && data.timestamp > startTimestamp) {
            return data.code;
          }
        }
      } catch (e) {
        log(`2FA poll error: ${e}`);
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }

    log('2FA poll timed out');
    return null;
  }

  /** Check if still logged in, re-login if needed. */
  async ensureLoggedIn(): Promise<Page> {
    const page = await this.ensureBrowser();

    if (this.loggedIn) {
      // Quick check — try navigating to manager page
      try {
        const url = page.url();
        if (url.includes('/manager/')) return page;

        await page.goto(`${MANAGER_BASE}/reservations`, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT,
        });
        // If redirected to login, we're not logged in
        if (page.url().includes('/login')) {
          this.loggedIn = false;
        } else {
          return page;
        }
      } catch {
        this.loggedIn = false;
      }
    }

    await this.login();
    return page;
  }

  /** Navigate to the reservations page for a specific date and open Add Reservation. */
  private async navigateToAddReservation(page: Page, date: string): Promise<void> {
    const dateForUrl = formatDateForUrl(date);
    const url = `${MANAGER_BASE}/reservations/day/${dateForUrl}`;
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // Wait for the page to be interactive
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });

    // Click "Add Reservation" button if the panel isn't already open
    const addBtn = page.locator('button:has-text("Add Reservation"), a:has-text("Add Reservation"), [data-test="add-reservation"]');
    if (await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addBtn.first().click();
      await page.waitForTimeout(2000); // Wait for panel animation
    }
  }

  /** Set the date in the reservation panel date picker. */
  private async setDate(page: Page, date: string): Promise<void> {
    const dateStr = formatDateForPicker(date);
    log(`Setting date to ${dateStr}`);

    // Find date input — could be a text input or date picker
    const dateInput = page.locator(
      'input[placeholder*="date" i], input[aria-label*="date" i], .date-picker input, input.vdp-datepicker__input, input[name="date"]'
    ).first();

    await dateInput.click({ timeout: 5000 });
    await dateInput.fill('');
    await dateInput.type(dateStr, { delay: 50 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500); // Wait for slots to refresh
  }

  /** Select guest/party size. */
  private async setPartySize(page: Page, partySize: number): Promise<void> {
    log(`Setting party size to ${partySize}`);

    if (partySize >= 2 && partySize <= 10) {
      // Click the numbered button
      const btn = page.locator(`button:has-text("${partySize}"), .party-size-btn:has-text("${partySize}")`).first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(1000);
        return;
      }
    }

    // Fallback: look for a party size input or the "..." custom button
    const customBtn = page.locator('button:has-text("..."), button:has-text("Other")').first();
    if (await customBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await customBtn.click();
      await page.waitForTimeout(500);
      const input = page.locator('input[type="number"], input[aria-label*="guest" i], input[aria-label*="party" i]').first();
      await input.fill(String(partySize));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1000);
    }
  }

  /**
   * Get available time slots for a given date and party size.
   */
  async getAvailability(date: string, partySize: number): Promise<TimeSlot[]> {
    const page = await this.ensureLoggedIn();
    await this.navigateToAddReservation(page, date);
    await this.setDate(page, date);
    await this.setPartySize(page, partySize);

    log('Reading time slots...');
    // Wait for slots to load
    await page.waitForTimeout(2000);

    // Time slots appear as elements with "HH:MM booked/capacity" text pattern
    // Try multiple selector strategies
    const slots: TimeSlot[] = [];

    // Strategy 1: Look for elements matching the "17:00 0/26" pattern
    const slotElements = await page.locator(
      '.time-slot, .timeslot, [class*="time-slot"], [class*="timeslot"], [class*="TimeSlot"], [data-test*="time-slot"]'
    ).all();

    if (slotElements.length > 0) {
      for (const el of slotElements) {
        const text = await el.textContent().catch(() => '');
        if (!text) continue;
        const match = text.match(/(\d{1,2}:\d{2})\s+(\d+)\/(\d+)/);
        if (match) {
          slots.push({
            time: match[1],
            booked: parseInt(match[2], 10),
            capacity: parseInt(match[3], 10),
          });
        }
      }
    }

    // Strategy 2: Broader text search if no structured slots found
    if (slots.length === 0) {
      const allText = await page.locator('body').textContent();
      const pattern = /(\d{1,2}:\d{2})\s+(\d+)\s*\/\s*(\d+)/g;
      let m;
      while ((m = pattern.exec(allText || '')) !== null) {
        slots.push({
          time: m[1],
          booked: parseInt(m[2], 10),
          capacity: parseInt(m[3], 10),
        });
      }
    }

    log(`Found ${slots.length} time slots`);
    return slots;
  }

  /**
   * Create a booking/reservation.
   */
  async createBooking(req: BookingRequest): Promise<BookingResult> {
    const page = await this.ensureLoggedIn();
    await this.navigateToAddReservation(page, req.date);
    await this.setDate(page, req.date);
    await this.setPartySize(page, req.partySize);

    // Wait for slots to load
    await page.waitForTimeout(2000);

    // Click the time slot
    log(`Selecting time slot ${req.time}`);
    const timeSlot = page.locator(`text=${req.time}`).first();
    if (!(await timeSlot.isVisible({ timeout: 5000 }).catch(() => false))) {
      return { success: false, message: `Time slot ${req.time} not found or not available` };
    }
    await timeSlot.click();
    await page.waitForTimeout(1000);

    // Fill guest details — try multiple selector patterns
    log('Filling guest details...');

    // Name field
    const nameInput = page.locator(
      'input[placeholder*="name" i], input[aria-label*="name" i], input[name="name"], input[data-test*="name"]'
    ).first();
    await nameInput.fill(req.name);

    // Phone field
    const phoneInput = page.locator(
      'input[placeholder*="phone" i], input[aria-label*="phone" i], input[name="phone"], input[type="tel"], input[data-test*="phone"]'
    ).first();
    await phoneInput.fill(req.phone);

    // Email field
    const emailInput = page.locator(
      'input[placeholder*="email" i], input[aria-label*="email" i], input[name="email"], input[type="email"]:not([name="password"]), input[data-test*="email"]'
    ).first();
    await emailInput.fill(req.email);

    // Notes (optional)
    if (req.notes) {
      const notesInput = page.locator(
        'textarea[placeholder*="note" i], textarea[aria-label*="note" i], textarea[name="notes"], input[placeholder*="note" i]'
      ).first();
      if (await notesInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await notesInput.fill(req.notes);
      }
    }

    // Click "Book Reservation"
    log('Clicking Book Reservation...');
    const bookBtn = page.locator(
      'button:has-text("Book Reservation"), button:has-text("Save Reservation"), button[data-test*="book"]'
    ).first();
    await bookBtn.click();

    // Wait for confirmation
    await page.waitForTimeout(3000);

    // Try to extract reservation ID from the resulting page/URL
    let reservationId: string | undefined;

    // Check URL for reservation ID
    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/reservations?\/([a-zA-Z0-9]+)/);
    if (urlMatch) {
      reservationId = urlMatch[1];
    }

    // Also look for confirmation text on page
    if (!reservationId) {
      const confirmText = await page.locator(
        '[class*="confirmation"], [class*="success"], [data-test*="confirmation"]'
      ).first().textContent().catch(() => '');
      const idMatch = confirmText?.match(/(?:ID|#|Confirmation)[:\s]*([A-Za-z0-9-]+)/i);
      if (idMatch) reservationId = idMatch[1];
    }

    // Check for error messages
    const errorEl = page.locator(
      '.error, .alert-danger, [class*="error"], [role="alert"]'
    ).first();
    const errorText = await errorEl.textContent().catch(() => '');
    if (errorText && errorText.toLowerCase().includes('error')) {
      return { success: false, message: `Booking failed: ${errorText.trim()}` };
    }

    log(`Booking created: ${reservationId || 'unknown ID'}`);
    return {
      success: true,
      reservationId,
      message: reservationId
        ? `Reservation ${reservationId} created successfully`
        : 'Reservation created (ID not captured)',
    };
  }

  /**
   * Get reservation status by ID.
   */
  async getBooking(reservationId: string): Promise<ReservationStatus> {
    const page = await this.ensureLoggedIn();

    // Navigate to the reservation — try the direct URL pattern
    const url = `${MANAGER_BASE}/reservations/${reservationId}`;
    log(`Navigating to reservation ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });

    // Extract details from the page
    const bodyText = await page.locator('body').textContent() || '';

    // Try to find status
    let status = 'unknown';
    for (const s of ['Confirmed', 'Cancelled', 'No Show', 'Seated', 'Completed', 'Pending']) {
      if (bodyText.includes(s)) {
        status = s.toLowerCase();
        break;
      }
    }

    return {
      reservationId,
      status,
    };
  }

  /** Clean up browser resources. */
  async close(): Promise<void> {
    log('Closing browser...');
    if (this.page) await this.page.close().catch(() => {});
    if (this.context) await this.context.close().catch(() => {});
    if (this.browser) await this.browser.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
    this.loggedIn = false;
  }
}

// Singleton instance
let instance: SevenRoomsAutomation | null = null;

export function getSevenRooms(): SevenRoomsAutomation {
  if (!instance) instance = new SevenRoomsAutomation();
  return instance;
}
