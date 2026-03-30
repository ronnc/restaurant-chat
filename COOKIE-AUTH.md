# Cookie-Based Authentication for SevenRooms

This setup uses saved browser cookies to authenticate with SevenRooms, bypassing reCAPTCHA and bot detection.

## Initial Setup

### 1. Extract Cookies (One-time)

```bash
cd restaurant-chat
npm run extract-cookies
```

**What happens:**
1. Browser window opens
2. **You manually log in** to SevenRooms
3. Navigate to manager dashboard
4. Press ENTER in terminal
5. Cookies are saved to `sevenrooms-cookies.json`

### 2. Verify Cookies Work

```bash
curl http://localhost:3456/api/booking/cookie-health
```

**Response:**
```json
{
  "healthy": true,
  "ageDays": 0,
  "daysUntilExpiry": 28,
  "message": "Cookies healthy (28 days until expiry)"
}
```

### 3. Test Booking API

```bash
curl "http://localhost:3456/api/booking/availability?date=2026-03-30&partySize=4"
```

Should now work without reCAPTCHA blocking!

## Production Workflow

### Monitoring (Daily Check)

Add to OpenClaw cron job:

```javascript
// Check cookie health daily at 9 AM
{
  "name": "SevenRooms Cookie Health Check",
  "schedule": {
    "kind": "cron",
    "expr": "0 9 * * *",
    "tz": "Australia/Melbourne"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "Check SevenRooms cookie health: curl http://localhost:3456/api/booking/cookie-health and alert me if not healthy"
  },
  "sessionTarget": "isolated"
}
```

### Cookie Refresh (When Needed)

**When to refresh:**
- Alert: "Cookies expire in 5 days"
- Error: "Cookies expired"
- Booking API starts failing

**How to refresh:**
```bash
cd restaurant-chat
npm run extract-cookies
# (log in manually again)
```

**Frequency:** Typically every 25-30 days

### Alternative: Manual via Browser

If you're already logged in to SevenRooms in Chrome:

1. Open Chrome DevTools (Cmd+Option+I)
2. Go to Application → Cookies → https://www.sevenrooms.com
3. Copy all cookies
4. Create `sevenrooms-cookies.json`:

```json
{
  "cookies": [...],
  "savedAt": 1711234567890,
  "expiresAt": 1713826567890
}
```

## Troubleshooting

### "No cookies found"
- Run `npm run extract-cookies` to set up initial cookies

### "Cookies expired"
- Run `npm run extract-cookies` again
- Make sure you complete the login flow

### "Failed to reach manager dashboard"
- Cookies may be invalid or expired
- Re-extract cookies
- Check that the account has manager access

### Cookies expire frequently
- SevenRooms may have shortened session timeout
- Consider: keeping browser open with automated activity
- Or: extract cookies from your regular Chrome (stays logged in)

## Security

**Cookie file location:** `restaurant-chat/sevenrooms-cookies.json`

**Contains:**
- Session tokens
- CSRF tokens
- Authentication cookies

**⚠️  Keep secure:**
- Add to `.gitignore` (already done)
- Don't commit to version control
- Backup encrypted if needed

## Files

- `extract-cookies.ts` - Cookie extraction tool
- `src/booking/cookie-store.ts` - Cookie persistence
- `sevenrooms-cookies.json` - Saved cookies (gitignored)
- `src/booking/routes.ts` - Adds `/api/booking/cookie-health`
