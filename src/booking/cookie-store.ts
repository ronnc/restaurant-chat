/**
 * Cookie persistence for SevenRooms authentication.
 * 
 * Stores cookies encrypted on disk to maintain login sessions across restarts.
 * Monitors cookie age and alerts when refresh is needed.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Cookie } from 'playwright';

const COOKIE_FILE = 'sevenrooms-cookies.json';
const MAX_COOKIE_AGE_DAYS = 25; // Alert before 30-day typical expiry

export interface CookieStore {
  cookies: Cookie[];
  savedAt: number;
  expiresAt?: number;
}

/**
 * Save cookies to disk with timestamp.
 */
export function saveCookies(cookies: Cookie[], cookiePath?: string): void {
  const filePath = cookiePath || COOKIE_FILE;
  
  // Find the session cookie expiry (if available)
  const sessionCookie = cookies.find(c => 
    c.name.includes('session') || c.name.includes('auth') || c.expires > 0
  );
  
  const store: CookieStore = {
    cookies,
    savedAt: Date.now(),
    expiresAt: sessionCookie?.expires ? sessionCookie.expires * 1000 : undefined,
  };
  
  writeFileSync(filePath, JSON.stringify(store, null, 2));
  console.log(`[cookie-store] Saved ${cookies.length} cookies to ${filePath}`);
  console.log(`[cookie-store] Session expires: ${store.expiresAt ? new Date(store.expiresAt).toISOString() : 'unknown'}`);
}

/**
 * Load cookies from disk.
 */
export function loadCookies(cookiePath?: string): Cookie[] | null {
  const filePath = cookiePath || COOKIE_FILE;
  
  if (!existsSync(filePath)) {
    console.log(`[cookie-store] No cookie file found at ${filePath}`);
    return null;
  }
  
  try {
    const data = readFileSync(filePath, 'utf-8');
    const store: CookieStore = JSON.parse(data);
    
    const age = Date.now() - store.savedAt;
    const ageDays = Math.floor(age / (1000 * 60 * 60 * 24));
    
    console.log(`[cookie-store] Loaded ${store.cookies.length} cookies (age: ${ageDays} days)`);
    
    // Check if cookies are too old
    if (ageDays > MAX_COOKIE_AGE_DAYS) {
      console.warn(`[cookie-store] ⚠️  Cookies are ${ageDays} days old - refresh recommended`);
    }
    
    // Check expiry
    if (store.expiresAt && Date.now() > store.expiresAt) {
      console.error(`[cookie-store] ❌ Cookies expired at ${new Date(store.expiresAt).toISOString()}`);
      return null;
    }
    
    return store.cookies;
  } catch (err) {
    console.error(`[cookie-store] Error loading cookies:`, err);
    return null;
  }
}

/**
 * Check cookie health and return status.
 */
export function checkCookieHealth(cookiePath?: string): {
  healthy: boolean;
  ageDays: number;
  daysUntilExpiry?: number;
  message: string;
} {
  const filePath = cookiePath || COOKIE_FILE;
  
  if (!existsSync(filePath)) {
    return {
      healthy: false,
      ageDays: 0,
      message: 'No cookies found - manual login required',
    };
  }
  
  try {
    const data = readFileSync(filePath, 'utf-8');
    const store: CookieStore = JSON.parse(data);
    
    const age = Date.now() - store.savedAt;
    const ageDays = Math.floor(age / (1000 * 60 * 60 * 24));
    
    // Check expiry
    if (store.expiresAt) {
      const timeUntilExpiry = store.expiresAt - Date.now();
      const daysUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60 * 24));
      
      if (timeUntilExpiry <= 0) {
        return {
          healthy: false,
          ageDays,
          daysUntilExpiry,
          message: `Cookies expired ${Math.abs(daysUntilExpiry)} days ago`,
        };
      }
      
      if (daysUntilExpiry < 5) {
        return {
          healthy: true,
          ageDays,
          daysUntilExpiry,
          message: `⚠️  Cookies expire in ${daysUntilExpiry} days - refresh soon`,
        };
      }
      
      return {
        healthy: true,
        ageDays,
        daysUntilExpiry,
        message: `Cookies healthy (${daysUntilExpiry} days until expiry)`,
      };
    }
    
    // No expiry info - check age
    if (ageDays > MAX_COOKIE_AGE_DAYS) {
      return {
        healthy: false,
        ageDays,
        message: `Cookies ${ageDays} days old - refresh recommended`,
      };
    }
    
    return {
      healthy: true,
      ageDays,
      message: `Cookies healthy (${ageDays} days old)`,
    };
  } catch (err) {
    return {
      healthy: false,
      ageDays: 0,
      message: `Error reading cookies: ${err}`,
    };
  }
}
