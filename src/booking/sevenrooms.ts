/**
 * SevenRooms browser automation via Playwright.
 *
 * Manages a persistent browser session for the SevenRooms manager dashboard.
 * Handles login, availability checks, and reservation creation.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { loadCookies, saveCookies, checkCookieHealth } from './cookie-store.js';

/** Same repo root as `src/server.ts` projectRoot (tsx: src/booking → ../.. ; prod: dist/booking → ../..). */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(dirname(MODULE_DIR));

const VENUE_SLUG = 'mydelhisunderland';
const BASE_URL = 'https://www.sevenrooms.com';
const LOGIN_URL = `${BASE_URL}/login`;
const MANAGER_BASE = `${BASE_URL}/manager/${VENUE_SLUG}`;
// Shift ID for DINNER shift (discovered from manual access)
const SHIFT_ID = 'ahNzfnNldmVucm9vbXMtc2VjdXJlchwLEg9uaWdodGxvb3BfVmVudWUYgIDMpoyKzgoM-DINNER-1654183576.02';
const NAV_TIMEOUT = 30_000;
const AVAILABILITY_SNAPSHOT_FILE = join(PROJECT_ROOT, 'sevenrooms-availability.json');
/** Default max age for {@link SevenRoomsAutomation.getAvailability} file cache (10 minutes). */
const DEFAULT_AVAILABILITY_CACHE_TTL_MS = 10 * 60 * 1000;

export interface TimeSlot {
  time: string;
  booked: number;
  capacity: number;
}

/**
 * Shape of `sevenrooms-availability.json`.
 * {@link SevenRoomsAutomation.getAvailability} writes `date` and `partySize` for keyed cache hits.
 */
export interface AvailabilitySnapshot {
  savedAt: string;
  slots: TimeSlot[];
  date?: string;
  partySize?: number;
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
  details?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    date?: string;
    time?: string;
    partySize?: number;
    venue?: string;
  };
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

function parsePartySizeField(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export class SevenRoomsAutomation {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private loggedIn = false;
  private useCookies = true; // Try cookies first

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

  /**
   * Max age (ms) of the on-disk availability snapshot before `getAvailability` refetches.
   * Set env `SEVENROOMS_AVAILABILITY_CACHE_TTL_MS` (numeric). Use `0` to disable caching.
   * Default: 10 minutes.
   */
  private get availabilityCacheTtlMs(): number {
    const v = process.env.SEVENROOMS_AVAILABILITY_CACHE_TTL_MS;
    if (v === '0') return 0;
    if (v != null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return DEFAULT_AVAILABILITY_CACHE_TTL_MS;
  }

  /** Launch browser if not already running. */
  private async ensureBrowser(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    log(`Launching browser... (headless=${this.headless}, BROWSER_HEADLESS=${process.env.BROWSER_HEADLESS})`);
    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
    
    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    
    this.page = await this.context.newPage();
    
    // Hide webdriver flag and other automation signals
    await this.page.addInitScript(() => {
      // Override the navigator.webdriver flag
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Mock chrome runtime
      (window as any).chrome = {
        runtime: {},
      };
      
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
    
    this.page.setDefaultTimeout(NAV_TIMEOUT);
    
    // Load cookies if available
    if (this.useCookies) {
      const cookies = loadCookies();
      if (cookies && cookies.length > 0) {
        log(`Loading ${cookies.length} saved cookies...`);
        await this.context.addCookies(cookies);
        this.loggedIn = true; // Assume logged in with cookies
        log('Cookies loaded - skipping login flow');
      } else {
        log('No saved cookies found - will use login flow');
        this.loggedIn = false;
      }
    } else {
      this.loggedIn = false;
    }
    
    return this.page;
  }

  /** Login to SevenRooms. */
  async login(): Promise<void> {
    const page = await this.ensureBrowser();
    log('Navigating to login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT });

    // Wait a bit for any dynamic content
    await page.waitForTimeout(2000);

    // Dismiss cookie banner if present
    const cookieOkBtn = page.locator('button:has-text("OK")').first();
    if (await cookieOkBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      log('Dismissing cookie banner...');
      await cookieOkBtn.click();
      await page.waitForTimeout(800 + Math.random() * 400); // 800-1200ms
    }

    // Fill credentials with realistic human-like behavior
    log('Filling email...');
    const emailInput = page.locator('input[name="email"], input[type="email"]').first();
    
    // Move mouse near the field first (simulate human mouse movement)
    await page.mouse.move(400 + Math.random() * 100, 300 + Math.random() * 50);
    await page.waitForTimeout(200 + Math.random() * 300);
    
    // Click the email field
    await emailInput.click();
    await page.waitForTimeout(400 + Math.random() * 300);
    
    // Type with slight delays (more human-like)
    await emailInput.pressSequentially(this.email, { delay: 50 + Math.random() * 100 });
    await page.waitForTimeout(300 + Math.random() * 400);
    
    log('Filling password...');
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    
    // Move mouse to password field
    await page.mouse.move(400 + Math.random() * 100, 350 + Math.random() * 50);
    await page.waitForTimeout(200 + Math.random() * 200);
    
    // Click password field
    await passwordInput.click();
    await page.waitForTimeout(300 + Math.random() * 300);
    
    // Type password with delays
    await passwordInput.pressSequentially(this.password, { delay: 40 + Math.random() * 80 });
    await page.waitForTimeout(500 + Math.random() * 500);

    // Take screenshot before clicking login
    await page.screenshot({ path: 'debug-before-login-click.png', fullPage: true });
    log('Screenshot saved: debug-before-login-click.png (showing filled credentials)');

    // Small pause before clicking submit (human-like)
    await page.waitForTimeout(600 + Math.random() * 600);
    
    // Click login button - try multiple strategies
    log('Looking for login button...');
    const buttonSelectors = [
      'button[type="submit"]',
      'button:has-text("Log In")',
      'button:has-text("Sign In")',
      'button:has-text("Login")',
      'button:has-text("Continue")',
      'input[type="submit"]',
      '[role="button"]:has-text("Log In")',
    ];

    let clicked = false;
    let clickedSelector = '';
    for (const selector of buttonSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          // Check if button is disabled
          const isDisabled = await btn.isDisabled().catch(() => false);
          log(`Found button with selector: ${selector}, disabled: ${isDisabled}`);
          
          if (isDisabled) {
            log('Button is disabled, trying force click...');
          }
          
          // Move mouse to button area first
          await page.mouse.move(400 + Math.random() * 100, 420 + Math.random() * 50);
          await page.waitForTimeout(150 + Math.random() * 200);
          
          await btn.click({ force: true });
          clicked = true;
          clickedSelector = selector;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    if (!clicked) {
      // Take a screenshot for debugging
      await page.screenshot({ path: 'login-debug.png', fullPage: true });
      throw new Error('Could not find login button. Screenshot saved to login-debug.png');
    }

    log(`Login button clicked (selector: ${clickedSelector}), waiting for async form submission...`);
    
    // The form submission is async - it needs to:
    // 1. Generate ThumbmarkJS fingerprint
    // 2. Get reCAPTCHA Enterprise token
    // 3. Then actually submit
    // We need to wait for the navigation that happens after all that completes
    
    // Wait for either:
    // - Navigation away from login page (success)
    // - 2FA prompt to appear
    // - Timeout (reCAPTCHA failed)
    
    log('Waiting for navigation or 2FA prompt (reCAPTCHA + fingerprint processing)...');
    
    const navigationOrPrompt = await Promise.race([
      // Wait for navigation away from /login
      page.waitForURL((url) => !url.toString().includes('/login'), { timeout: 45_000 })
        .then(() => 'navigated')
        .catch(() => null),
      
      // Wait for 2FA input to appear
      page.waitForSelector('input[name="code"], input[placeholder*="code" i], input[type="tel"], input[inputmode="numeric"]', { timeout: 45_000 })
        .then(() => '2fa')
        .catch(() => null),
      
      // Timeout fallback - give it 45 seconds for reCAPTCHA
      page.waitForTimeout(45_000).then(() => 'timeout'),
    ]).then(result => result || 'timeout');
    
    log(`Result after waiting: ${navigationOrPrompt}`);
    
    // Take screenshot and check URL
    await page.screenshot({ path: 'debug-after-login-click.png', fullPage: true });
    log('Screenshot saved: debug-after-login-click.png');
    
    const currentUrl = page.url();
    log(`Current URL: ${currentUrl}`);
    
    // Check for error messages
    const errorText = await page.locator('.error, .alert, [role="alert"], [class*="error"]').allTextContents();
    if (errorText.length > 0) {
      log(`Error messages found: ${JSON.stringify(errorText)}`);
    }
    
    // If we timed out and still on login page, reCAPTCHA likely failed
    if (navigationOrPrompt === 'timeout' && currentUrl.includes('/login')) {
      log('⚠️  Timeout waiting for form submission - reCAPTCHA may have blocked the request');
      log('Button is likely still disabled, indicating reCAPTCHA did not complete');
      
      // Check button state
      const btnState = await page.locator('#login-btn').first().evaluate(el => ({
        disabled: (el as HTMLInputElement).disabled,
        value: (el as HTMLInputElement).value,
      })).catch(() => ({ disabled: 'unknown', value: 'unknown' }));
      log(`Login button state: ${JSON.stringify(btnState)}`);
    }

    // Check the result from our earlier wait
    const needs2FA = navigationOrPrompt === '2fa';

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

    // Check where we landed after login
    await page.waitForTimeout(2000);
    const postLoginUrl = page.url();
    log(`Post-login URL: ${postLoginUrl}`);
    await page.screenshot({ path: 'debug-post-login.png', fullPage: true });
    log('Post-login screenshot saved');

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
      // We have cookies loaded - verify they work
      try {
        const url = page.url();
        if (url.includes('/manager/')) {
          log('Already on manager page');
          return page;
        }

        // Navigate to manager base to verify cookies work
        log('Verifying cookie session...');
        await page.goto(MANAGER_BASE, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT,
        });
        
        await page.waitForTimeout(2000);
        
        // Check if we successfully reached the manager dashboard
        const currentUrl = page.url();
        log(`After cookie authentication: ${currentUrl}`);
        
        if (currentUrl.includes('/manager/')) {
          log('✅ Cookie authentication successful');
          return page;
        }
        
        // Cookies failed - they may be expired
        log('⚠️  Cookies failed - redirected away from manager. Cookies may be expired.');
        this.loggedIn = false;
        throw new Error('Cookie authentication failed. Please run: npm run extract-cookies');
      } catch (e) {
        log(`Cookie session check failed: ${e}`);
        throw e; // Re-throw - don't try traditional login
      }
    }

    // No cookies - warn and try traditional login (will likely fail)
    log('⚠️  No cookies - attempting traditional login (may fail due to bot detection)');
    await this.login();
    
    // After login, navigate to manager base to establish session
    log('Navigating to manager base after login...');
    await page.goto(MANAGER_BASE, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT,
    });
    await page.waitForTimeout(3000);
    
    const finalUrl = page.url();
    log(`Final URL after login: ${finalUrl}`);
    
    if (!finalUrl.includes('/manager/')) {
      throw new Error(`Failed to reach manager dashboard. Ended at: ${finalUrl}. Please run: npm run extract-cookies to use cookie authentication.`);
    }
    
    return page;
  }

  /** Dismiss Pendo overlay that blocks UI interactions. */
  private async dismissPendo(page: Page): Promise<void> {
    try {
      // Try to close Pendo guide/tooltip
      const pendoClose = page.locator('#pendo-close-guide-button, .pendo-close-guide, [id*="pendo"] button:has-text("×"), [id*="pendo"] button:has-text("Close")').first();
      if (await pendoClose.isVisible({ timeout: 1000 }).catch(() => false)) {
        log('Dismissing Pendo guide...');
        await pendoClose.click({ timeout: 2000 });
        await page.waitForTimeout(500);
      }
      
      // Force remove Pendo container if still present
      await page.evaluate(() => {
        const pendoBase = document.getElementById('pendo-base');
        const pendoContainer = document.getElementById('pendo-guide-container');
        if (pendoBase) {
          pendoBase.remove();
          console.log('[sevenrooms] Removed pendo-base');
        }
        if (pendoContainer) {
          pendoContainer.remove();
          console.log('[sevenrooms] Removed pendo-guide-container');
        }
      });
      log('Pendo overlay removed');
    } catch (e) {
      log(`Pendo dismissal failed (non-fatal): ${e}`);
    }
  }

  /** Navigate to the reservations page for a specific date and open Add Reservation. */
  private async navigateToAddReservation(page: Page, date: string): Promise<void> {
    const dateForUrl = formatDateForUrl(date);
    const url = `${MANAGER_BASE}/reservations/day/${dateForUrl}?shift_id=${SHIFT_ID}`;
    log(`Navigating to ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

    // Wait for the page to be interactive - don't fail on timeout
    try {
      await page.waitForLoadState('networkidle', { timeout: NAV_TIMEOUT });
    } catch (e) {
      log('Network idle timeout - continuing anyway');
    }
    await page.waitForTimeout(3000);

    // Dismiss Pendo overlay before interacting
    await this.dismissPendo(page);

    // Take screenshot for debugging
    await page.screenshot({ path: 'debug-01-reservations-page.png', fullPage: true });
    log('Screenshot saved: debug-01-reservations-page.png');

    // Look for Add Reservation button with multiple strategies
    const addBtnSelectors = [
      'button:has-text("Add Reservation")',
      'a:has-text("Add Reservation")',
      '[data-test="add-reservation"]',
      'button:has-text("Add")',
      '[class*="add"][class*="reservation"]',
    ];

    let clicked = false;
    for (const selector of addBtnSelectors) {
      const addBtn = page.locator(selector).first();
      if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        log(`Found Add Reservation button: ${selector}`);
        await addBtn.click();
        await page.waitForTimeout(2000); // Wait for panel animation
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      log('No Add Reservation button found - may already be on the form');
    }

    // Dismiss Pendo again in case it reappeared
    await this.dismissPendo(page);

    await page.screenshot({ path: 'debug-02-after-add-click.png', fullPage: true });
    log('Screenshot saved: debug-02-after-add-click.png');
  }

  /** Set the date in the reservation panel date picker. */
  private async setDate(page: Page, date: string): Promise<void> {
    const dateStr = formatDateForPicker(date);
    log(`Setting date to ${dateStr}`);

    // Date is already in URL - may not need to set it again
    // Check if we're already on the right date
    const currentUrl = page.url();
    if (currentUrl.includes(formatDateForUrl(date))) {
      log('Already on correct date page');
      return;
    }

    await page.screenshot({ path: 'debug-03-before-date.png', fullPage: true });

    // Try multiple strategies to find and set date
    const dateSelectors = [
      'input[type="date"]',
      'input[name="date"]',
      'input[placeholder*="date" i]',
      'input[aria-label*="date" i]',
      '.date-picker input',
      'input.vdp-datepicker__input',
      '[class*="date"] input',
    ];

    let dateSet = false;
    for (const selector of dateSelectors) {
      const dateInput = page.locator(selector).first();
      if (await dateInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        log(`Found date input: ${selector}`);
        try {
          await dateInput.click();
          await dateInput.fill('');
          await dateInput.type(dateStr, { delay: 50 });
          await page.keyboard.press('Enter');
          await page.waitForTimeout(1000);
          dateSet = true;
          break;
        } catch (e) {
          log(`Failed to set date with selector ${selector}: ${e}`);
        }
      }
    }

    if (!dateSet) {
      log('Could not find date input - may not be needed');
    }

    await page.screenshot({ path: 'debug-04-after-date.png', fullPage: true });
  }

  /** Select guest/party size. */
  private async setPartySize(page: Page, partySize: number): Promise<void> {
    log(`Setting party size to ${partySize}`);
    
    // Only support party sizes 2-10 (direct buttons visible in UI)
    if (partySize < 2 || partySize > 10) {
      throw new Error(`Party size ${partySize} not supported. Please use 2-10 guests.`);
    }

    // Try multiple selector strategies for the numbered buttons
    const selectors = [
      `button:has-text("${partySize}")`,
      `[role="button"]:has-text("${partySize}")`,
      `div:has-text("${partySize}"):not(:has(*))`, // div with just the number
      `*:has-text("${partySize}")`,
    ];
    
    for (const selector of selectors) {
      const btn = page.locator(selector).first();
      
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        log(`Found party size button with selector: ${selector}`);
        try {
          await btn.click();
          await page.waitForTimeout(1000);
          log('Party size set');
          return;
        } catch (e) {
          log(`Click failed with ${selector}, trying next...`);
        }
      }
    }
    
    throw new Error(`Could not find clickable party size button for ${partySize} guests`);
  }

  /**
   * Get available time slots for a given date and party size.
   * Uses `sevenrooms-availability.json` when fresh (see `SEVENROOMS_AVAILABILITY_CACHE_TTL_MS`).
   */
  async getAvailability(date: string, partySize: number): Promise<TimeSlot[]> {
    const ttl = this.availabilityCacheTtlMs;
    if (ttl > 0) {
      const cached = this.tryLoadAvailabilityFromCache(date, partySize, ttl);
      if (cached !== null) return cached;
    }

    const slots = await this.fetchAvailabilityFromPage(date, partySize);

    if (ttl > 0) this.persistAvailabilityCache(date, partySize, slots);
    return slots;
  }

  private tryLoadAvailabilityFromCache(
    date: string,
    partySize: number,
    ttlMs: number
  ): TimeSlot[] | null {
    const snap = this.loadAvailabilitySnapshotFromDisk();
    if (!snap) return null;
    if (snap.date !== date || snap.partySize === undefined || snap.partySize !== partySize) {
      log(
        `Availability cache miss: request ${date} party ${partySize} ≠ stored ${String(snap.date ?? '(none)')} party ${String(snap.partySize ?? '(none)')}`
      );
      return null;
    }
    const t = Date.parse(snap.savedAt);
    if (!Number.isFinite(t)) return null;
    const ageMs = Date.now() - t;
    if (ageMs >= ttlMs) {
      log(
        `Availability file stale (${Math.round(ageMs / 1000)}s old ≥ ${Math.round(ttlMs / 1000)}s ttl), refetching`
      );
      return null;
    }
    log(
      `Availability cache hit for ${date} / party ${partySize} (age ${Math.round(ageMs / 1000)}s)`
    );
    return snap.slots;
  }

  private persistAvailabilityCache(date: string, partySize: number, slots: TimeSlot[]): void {
    const payload: AvailabilitySnapshot = {
      savedAt: new Date().toISOString(),
      date,
      partySize,
      slots,
    };
    writeFileSync(AVAILABILITY_SNAPSHOT_FILE, JSON.stringify(payload, null, 2));
    log(`Wrote availability cache (${slots.length} slot(s)) for ${date} party ${partySize}`);
  }

  private async fetchAvailabilityFromPage(date: string, partySize: number): Promise<TimeSlot[]> {
    const page = await this.ensureLoggedIn();
    await this.navigateToAddReservation(page, date);
    await this.setDate(page, date);
    await this.setPartySize(page, partySize);

    log('Reading time slots...');
    await page.waitForTimeout(1000);

    await page.screenshot({ path: 'debug-07-slots.png', fullPage: true });
    log('Screenshot saved: debug-07-slots.png');

    const slots: TimeSlot[] = [];

    const slotElements = await page.locator('[data-test="sr-timeslot"].sr-timeslot-bookable').all();

    log(`Found ${slotElements.length} bookable time slots`);

    for (const slotEl of slotElements) {
      try {
        const timeEl = slotEl.locator('[data-test="sr-timeslot_time"]');
        const time = await timeEl.textContent().catch(() => '');
        log(`Found slot with time: ${time}`);
        const pacingEl = slotEl.locator('[data-test="sr-timeslot_pacing"]');
        const pacing = await pacingEl.textContent().catch(() => '');
        log(`pacing ${pacing}`);
        if (time && pacing) {
          const match = pacing.match(/(\d+)\/(\d+)/);
          if (match) {
            const booked = parseInt(match[1], 10);
            const capacity = parseInt(match[2], 10);

            slots.push({
              time: time.trim(),
              booked,
              capacity,
            });
          }
        }
      } catch (e) {
        log(`Failed to extract slot: ${e}`);
      }
    }

    if (slots.length === 0) {
      log('No structured slots found, searching page text...');
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

    if (slots.length === 0) {
      const html = await page.content();
      log('No slots found. Page HTML length: ' + html.length);
      await page.evaluate(() => {
        const debugDiv = document.createElement('div');
        debugDiv.id = 'debug-info';
        debugDiv.textContent = 'NO SLOTS FOUND - check debug-07-slots.png';
        document.body.prepend(debugDiv);
      });
    }

    return slots;
  }

  /** Parse `sevenrooms-availability.json` with no logging (other than parse errors). */
  private loadAvailabilitySnapshotFromDisk(): AvailabilitySnapshot | null {
    if (!existsSync(AVAILABILITY_SNAPSHOT_FILE)) return null;
    try {
      const raw = readFileSync(AVAILABILITY_SNAPSHOT_FILE, 'utf-8');
      const data = JSON.parse(raw) as unknown;
      if (
        !data ||
        typeof data !== 'object' ||
        !('slots' in data) ||
        !Array.isArray((data as AvailabilitySnapshot).slots)
      ) {
        return null;
      }
      const o = data as Record<string, unknown>;
      const savedAt = typeof o.savedAt === 'string' ? o.savedAt : '';
      const slots = o.slots as TimeSlot[];
      const date = typeof o.date === 'string' ? o.date.trim() : undefined;
      const partySize = parsePartySizeField(o.partySize);
      return { savedAt, slots, date, partySize };
    } catch (e) {
      log(`Failed to load ${AVAILABILITY_SNAPSHOT_FILE}: ${e}`);
      return null;
    }
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
    log('Waiting for slots to load...');
    await page.waitForTimeout(3000);
    
    // Click the sr-timeslot-bookable div to SELECT the time slot
    log(`Selecting time slot ${req.time}`);
    
    // Find the bookable slot with the matching time and click it
    const bookableSlots = await page.locator('[data-test="sr-timeslot"].sr-timeslot-bookable').all();
    log(`Found ${bookableSlots.length} bookable slots`);
    
    let slotClicked = false;
    for (const slotEl of bookableSlots) {
      try {
        const timeEl = slotEl.locator('[data-test="sr-timeslot_time"]');
        const slotTime = await timeEl.textContent();
        
        if (slotTime?.trim() === req.time) {
          log(`Found sr-timeslot for ${req.time}, clicking...`);
          // Click with force to bypass any overlays
          await slotEl.click({ force: true });
          log(`✅ Clicked sr-timeslot for ${req.time}`);
          slotClicked = true;
          break;
        }
      } catch (e) {
        log(`Failed to check/click slot: ${e}`);
      }
    }
    
    if (!slotClicked) {
      log(`Could not find bookable slot for ${req.time}`);
      return { success: false, message: `Time slot ${req.time} not found` };
    }
    
    await page.waitForTimeout(2000);
    
    // Take screenshot after clicking time slot
    await page.screenshot({ path: 'debug-03-after-time-click.png', fullPage: true });
    log('Screenshot saved: debug-03-after-time-click.png');

    // Fill guest details in the sr-name-phone-email field
    log('Filling sr-name-phone-email field with combined format...');

    // Normalize phone: digits only, strip leading +44/0044/0 to get bare UK number (e.g. 7123456789)
    let ukPhone = req.phone.replace(/\D/g, '');
    if (ukPhone.startsWith('44')) {
      ukPhone = ukPhone.substring(2);
    } else if (ukPhone.startsWith('0')) {
      ukPhone = ukPhone.substring(1);
    }
    
    // SevenRooms expects: "FirstName LastName, UKPhone, Email"
    const clientString = `${req.name}, ${ukPhone}, ${req.email}`;
    log(`Client string to fill: ${clientString}`);

    // Try to find the sr-name-phone-email field
    const combinedFieldSelectors = [
      'input[data-test="sr-name-phone-email"]',
      'input[id*="name-phone-email"]',
      'input[placeholder*="Name, Phone" i]',
    ];
    
    let combinedFilled = false;
    for (const selector of combinedFieldSelectors) {
      const field = page.locator(selector).first();
      if (await field.isVisible({ timeout: 2000 }).catch(() => false)) {
        await field.fill(clientString);
        log(`✅ Combined field filled with: ${clientString} (selector: ${selector})`);
        combinedFilled = true;
        break;
      }
    }
    
    if (!combinedFilled) {
      log('⚠️ Warning: sr-name-phone-email field not found, trying separate fields...');
      
      // Fallback: try separate phone and email fields
      const phoneField = page.locator('input[placeholder*="phone" i]').first();
      if (await phoneField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await phoneField.fill(req.phone);
        log(`Phone filled separately`);
      }
      
      const emailField = page.locator('input[placeholder*="email" i]').first();
      if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
        await emailField.fill(req.email);
        log(`Email filled separately`);
      }
    }

    // Notes (optional)
    if (req.notes) {
      const notesSelectors = [
        'textarea[placeholder*="note" i]',
        'textarea[aria-label*="note" i]',
        'input[placeholder*="note" i]',
        'textarea[data-test*="note"]',
      ];
      
      for (const selector of notesSelectors) {
        const field = page.locator(selector).first();
        if (await field.isVisible({ timeout: 2000 }).catch(() => false)) {
          await field.fill(req.notes);
          log(`Notes filled with selector: ${selector}`);
          break;
        }
      }
    }
    
    // Wait for SevenRooms to auto-parse the client info
    log('Waiting for client info to be parsed...');
    await page.waitForTimeout(2000);
    
    // Take screenshot after filling client info
    await page.screenshot({ path: 'debug-04-after-client-fill.png', fullPage: true });
    log('Screenshot saved: debug-04-after-client-fill.png');
    
    // Check if "Add as New Client" button appears (means client not found)
    log('Checking if "Add as New Client" button appears...');
    const addNewClientBtn = page.locator('button:has-text("Add as New Client")').first();
    
    if (await addNewClientBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      log('✅ "Add as New Client" button found - clicking it');
      try {
        await addNewClientBtn.click({ force: true });
        log('✅ Clicked "Add as New Client"');
        await page.waitForTimeout(2000);
        
        // Take screenshot after clicking
        await page.screenshot({ path: 'debug-05-after-add-client.png', fullPage: true });
        log('Screenshot saved: debug-05-after-add-client.png');
        
        // The client should now be added since we filled the combined field correctly
        log('✅ Client should be added from the combined field');
      } catch (e) {
        log(`Failed to click Add as New Client: ${e}`);
        return { success: false, message: 'Failed to add client to reservation' };
      }
    }
    
    // Take screenshot before submitting
    await page.screenshot({ path: 'debug-06-before-submit.png', fullPage: true });
    log('Screenshot saved: debug-06-before-submit.png');

    // Click "Book Reservation"
    log('Clicking Book Reservation...');
    const bookBtn = page.locator(
      'button:has-text("Book Reservation"), button:has-text("Save Reservation"), button:has-text("BOOK RESERVATION"), button[data-test*="book"], button[data-test*="submit"]'
    ).first();
    
    if (await bookBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Store initial URL to detect navigation
      const beforeUrl = page.url();
      
      await bookBtn.click();
      log('Book button clicked');
      
      // Wait for navigation or panel update (SevenRooms may update in-place or navigate)
      try {
        await Promise.race([
          page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 10000 }),
          page.waitForTimeout(5000), // Fallback if no navigation
        ]);
      } catch (e) {
        log('No navigation detected after booking');
      }
    } else {
      log('Warning: Book Reservation button not found');
      await page.screenshot({ path: 'debug-05-no-submit-button.png', fullPage: true });
      return { success: false, message: 'Book Reservation button not found' };
    }

    // Wait for confirmation UI or error dialog to appear
    await page.waitForTimeout(3000);

    // Check for SevenRooms error dialog/banner
    const errorSelectors = [
      'sr-error-dialog',
      '[class*="sr-error"]',
      '[class*="error-banner"]',
      '[class*="error-dialog"]',
      '[class*="alert-danger"]',
      '[class*="notification-error"]',
      '[role="alert"]',
    ];
    for (const sel of errorSelectors) {
      const errorEl = page.locator(sel).first();
      if (await errorEl.isVisible({ timeout: 1000 }).catch(() => false)) {
        const errorText = await errorEl.textContent().catch(() => 'Unknown validation error');
        if (errorText && errorText.trim().length > 0) {
          log(`❌ SevenRooms error: ${errorText.trim()}`);
          await page.screenshot({ path: 'debug-07-error-dialog.png', fullPage: true });
          log('Screenshot saved: debug-07-error-dialog.png');
          return { success: false, message: errorText.trim() };
        }
      }
    }
    // Also check for any visible text containing common error phrases
    const errorBanner = page.locator(':visible:text-matches("is not valid|is invalid|required field|cannot be blank", "i")').first();
    if (await errorBanner.isVisible({ timeout: 1000 }).catch(() => false)) {
      const errorText = await errorBanner.textContent().catch(() => 'Validation error');
      log(`❌ SevenRooms validation error: ${errorText?.trim()}`);
      await page.screenshot({ path: 'debug-07-error-dialog.png', fullPage: true });
      return { success: false, message: errorText?.trim() || 'Validation error' };
    }
    
    // Take screenshot after submission
    await page.screenshot({ path: 'debug-07-after-submit.png', fullPage: true });
    log('Screenshot saved: debug-07-after-submit.png');

    // Try to extract reservation ID from the resulting page/URL
    let reservationId: string | undefined;

    // Check URL for reservation ID - avoid matching "day" from the date path
    const currentUrl = page.url();
    log(`Post-booking URL: ${currentUrl}`);
    
    // Look for reservation detail page pattern (e.g., /reservations/ABC123 or /reservation/ABC123)
    // Exclude "day" which is part of the date path
    const urlMatch = currentUrl.match(/\/reservations?\/([a-zA-Z0-9_-]+)(?:\?|$)/);
    if (urlMatch && urlMatch[1] !== 'day') {
      reservationId = urlMatch[1];
      log(`Found reservation ID in URL: ${reservationId}`);
    }

    // Look for confirmation text or reservation number on the page
    if (!reservationId) {
      log('Searching page for reservation ID...');
      
      // Try the slideout title first (most reliable)
      const slideoutTitle = page.locator('[data-test="sr-slideout-title"]').first();
      const titleText = await slideoutTitle.textContent().catch(() => '');
      if (titleText) {
        log(`Slideout title text: "${titleText}"`);
        // Format: "Reservation <id>"
        const match = titleText.match(/Reservation\s+([A-Za-z0-9_-]+)/i);
        if (match && match[1] && match[1].toLowerCase() !== 'day') {
          reservationId = match[1];
          log(`Found reservation ID in slideout title: ${reservationId}`);
        }
      }
      
      // Fallback: Try to find reservation confirmation number in various places
      if (!reservationId) {
        const selectors = [
          '[class*="confirmation"]',
          '[class*="success"]',
          '[data-test*="confirmation"]',
          '[class*="reservation"][class*="id"]',
          'h1, h2, h3, h4',
          '.modal-title',
          '[role="dialog"] h2',
        ];
        
        for (const selector of selectors) {
          const el = page.locator(selector).first();
          const text = await el.textContent().catch(() => '');
          if (text) {
            // Look for patterns like "Confirmation #123", "Reservation ID: ABC", etc.
            const patterns = [
              /(?:confirmation|reservation)\s*(?:#|id|number)?[:\s]+([A-Za-z0-9_-]+)/i,
              /#([A-Za-z0-9_-]{6,})/,
              /\b([A-Z0-9]{8,})\b/,
            ];
            
            for (const pattern of patterns) {
              const match = text.match(pattern);
              if (match && match[1] && match[1].toLowerCase() !== 'day') {
                reservationId = match[1];
                log(`Found reservation ID in page text: ${reservationId} (selector: ${selector})`);
                break;
              }
            }
            if (reservationId) break;
          }
        }
      }
    }

    // Check for error messages
    const errorEl = page.locator(
      '.error, .alert-danger, [class*="error"], [role="alert"]'
    ).first();
    const errorText = await errorEl.textContent().catch(() => '');
    if (errorText && errorText.toLowerCase().includes('error')) {
      return { success: false, message: `Booking failed: ${errorText.trim()}` };
    }

    // Extract booking details from the reservation slideout using data-test selectors
    const details: BookingResult['details'] = {};
    try {
      await page.waitForTimeout(2000);

      // Venue
      const venueEl = page.locator('[data-test="sr-label-venue_name"]').first();
      details.venue = await venueEl.textContent({ timeout: 2000 }).then(t => t?.trim()).catch(() => undefined);

      // Date
      const dateEl = page.locator('[data-test="sr-label-reservation_date"]').first();
      details.date = await dateEl.textContent({ timeout: 2000 }).then(t => t?.trim()).catch(() => req.date);

      // Time
      const timeEl = page.locator('[data-test="sr-label-reservation_time"]').first();
      details.time = await timeEl.textContent({ timeout: 2000 }).then(t => t?.trim()).catch(() => req.time);

      // Party size
      const partySizeEl = page.locator('[data-test="sr-label-party_size"]').first();
      const partySizeText = await partySizeEl.textContent({ timeout: 2000 }).catch(() => '');
      details.partySize = partySizeText ? parseInt(partySizeText.trim(), 10) || req.partySize : req.partySize;

      // Contact section - phone and email
      const contactSection = page.locator('[data-test="sr-section-contact"]').first();
      if (await contactSection.isVisible({ timeout: 2000 }).catch(() => false)) {
        const contactText = await contactSection.textContent().catch(() => '');
        // Extract phone
        const phoneMatch = contactText?.match(/PHONE\s*([\d\s+]+)/i);
        if (phoneMatch) details.phone = phoneMatch[1].trim();
        // Extract email
        const emailMatch = contactText?.match(/EMAIL\s*([\w.+-]+@[\w.-]+\.\w+)/i);
        if (emailMatch) details.email = emailMatch[1];
      }

      // Guest name from the slideout header
      const slideoutTitle = page.locator('[data-test="sr-slideout-title"]').first();
      const titleText = await slideoutTitle.textContent().catch(() => '');
      // After the title, the guest name appears in the header area
      // Try to get the client name from the slideout
      const clientNameEl = page.locator('[data-test="sr-client-name"], [data-test="sr-label-client_name"]').first();
      const clientName = await clientNameEl.textContent({ timeout: 2000 }).catch(() => '');
      if (clientName && clientName.trim()) {
        const parts = clientName.trim().split(/\s+/);
        details.firstName = parts[0];
        details.lastName = parts.slice(1).join(' ') || undefined;
      }

      // Fallback: use the name from the request
      if (!details.firstName) {
        const parts = req.name.split(/\s+/);
        details.firstName = parts[0];
        details.lastName = parts.slice(1).join(' ') || undefined;
      }

      await page.screenshot({ path: 'debug-08-reservation-detail.png', fullPage: true });
      log(`Extracted booking details: ${JSON.stringify(details)}`);
    } catch (e) {
      log(`Warning: could not extract all booking details: ${(e as Error).message}`);
      // Fallback to request data
      if (!details.date) details.date = req.date;
      if (!details.time) details.time = req.time;
      if (!details.partySize) details.partySize = req.partySize;
    }

    log(`Booking created: ${reservationId || 'unknown ID'}`);
    return {
      success: true,
      reservationId,
      details,
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

  /**
   * Save current session cookies to disk.
   * Call this after successful manual login to persist authentication.
   */
  async saveSessionCookies(): Promise<void> {
    if (!this.context) {
      throw new Error('No browser context - cannot save cookies');
    }
    
    const cookies = await this.context.cookies();
    saveCookies(cookies);
    log(`Saved ${cookies.length} cookies for future sessions`);
  }

  /**
   * Check health of saved cookies.
   */
  checkCookieHealth(): ReturnType<typeof checkCookieHealth> {
    return checkCookieHealth();
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
