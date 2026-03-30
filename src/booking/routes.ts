/**
 * Booking API routes for SevenRooms automation.
 *
 * Mount in your Express app:
 *   import { bookingRouter } from './booking/routes.js';
 *   app.use(bookingRouter);
 */
import { Router, type Request, type Response } from 'express';
import { getSevenRooms } from './sevenrooms.js';
import { checkCookieHealth } from './cookie-store.js';

export const bookingRouter = Router();

/**
 * GET /api/booking/availability?date=2026-03-20&partySize=4
 */
bookingRouter.get('/api/booking/availability', async (req: Request, res: Response) => {
  const { date, partySize } = req.query;

  if (!date || typeof date !== 'string') {
    res.status(400).json({ error: 'date query parameter required (YYYY-MM-DD)' });
    return;
  }
  if (!partySize || isNaN(Number(partySize))) {
    res.status(400).json({ error: 'partySize query parameter required (number)' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
    return;
  }
  const partySizeNum = Number(partySize);
  if (partySizeNum < 2 || partySizeNum > 10) {
    res.status(400).json({ error: 'partySize must be between 2 and 10 guests' });
    return;
  }

  try {
    const sr = getSevenRooms();
    const slots = await sr.getAvailability(date, Number(partySize));
    res.json({ date, partySize: Number(partySize), slots });
  } catch (err) {
    console.error('[booking/availability] Error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/booking/reserve
 * Body: { date, time, partySize, name, phone, email, notes? }
 */
bookingRouter.post('/api/booking/reserve', async (req: Request, res: Response) => {
  const { date, time, partySize, name, phone, email, notes } = req.body;

  const missing = [];
  if (!date) missing.push('date');
  if (!time) missing.push('time');
  if (!partySize) missing.push('partySize');
  if (!name) missing.push('name');
  if (!phone) missing.push('phone');
  if (!email) missing.push('email');

  if (missing.length > 0) {
    res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    return;
  }
  
  // Validate name has both first and last name
  const nameParts = name.trim().split(/\s+/);
  if (nameParts.length < 2) {
    res.status(400).json({ error: 'Name must include both first and last name (e.g., "John Smith")' });
    return;
  }
  
  if (partySize < 2 || partySize > 10) {
    res.status(400).json({ error: 'partySize must be between 2 and 10 guests' });
    return;
  }

  try {
    const sr = getSevenRooms();
    const result = await sr.createBooking({ date, time, partySize, name, phone, email, notes });
    res.json(result);
  } catch (err) {
    console.error('[booking/reserve] Error:', err);
    res.status(500).json({ success: false, message: (err as Error).message });
  }
});

/**
 * GET /api/booking/status/:reservationId
 */
bookingRouter.get('/api/booking/status/:reservationId', async (req: Request, res: Response) => {
  const { reservationId } = req.params;

  try {
    const sr = getSevenRooms();
    const status = await sr.getBooking(reservationId as string);
    res.json(status);
  } catch (err) {
    console.error('[booking/status] Error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/booking/cookie-health
 * Check the health status of saved SevenRooms cookies.
 */
bookingRouter.get('/api/booking/cookie-health', (req: Request, res: Response) => {
  try {
    const health = checkCookieHealth();
    res.json(health);
  } catch (err) {
    console.error('[booking/cookie-health] Error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});
