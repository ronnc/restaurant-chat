#!/usr/bin/env node
/**
 * Cookie extraction helper for SevenRooms.
 * 
 * Usage:
 *   npm run extract-cookies
 * 
 * This will:
 * 1. Open a browser window
 * 2. Wait for you to manually log in to SevenRooms
 * 3. Extract and save cookies automatically
 * 4. Close the browser
 */

import { chromium } from 'playwright';
import { saveCookies } from './src/booking/cookie-store.js';

const LOGIN_URL = 'https://www.sevenrooms.com/login';

async function extractCookies() {
  console.log('🍪 SevenRooms Cookie Extractor');
  console.log('================================\n');
  
  console.log('1. Opening browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  
  const page = await context.newPage();
  
  console.log('2. Navigating to SevenRooms login page...');
  await page.goto(LOGIN_URL);
  
  console.log('\n📋 Instructions:');
  console.log('   1. Log in manually in the browser window');
  console.log('   2. Wait until you see the manager dashboard');
  console.log('   3. Come back here and press ENTER\n');
  
  // Wait for user input
  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });
  
  console.log('\n3. Extracting cookies...');
  const cookies = await context.cookies();
  
  // Filter for important cookies
  const relevantCookies = cookies.filter(c => 
    c.domain.includes('sevenrooms.com')
  );
  
  if (relevantCookies.length === 0) {
    console.error('❌ No SevenRooms cookies found. Did you log in successfully?');
    await browser.close();
    process.exit(1);
  }
  
  console.log(`   Found ${relevantCookies.length} SevenRooms cookies`);
  
  // Save cookies
  saveCookies(relevantCookies);
  
  console.log('\n✅ Cookies saved successfully!');
  console.log('   File: sevenrooms-cookies.json');
  console.log('   The automation can now use these cookies to access SevenRooms.\n');
  
  // Close browser
  await browser.close();
  process.exit(0);
}

extractCookies().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
