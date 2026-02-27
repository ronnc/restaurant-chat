/**
 * BookingProvider — abstract base for browser-driven restaurant booking.
 *
 * Every concrete provider must implement `book(page, details)`.
 */
export class BookingProvider {
  /** Human-readable name, e.g. "SevenRooms" */
  name = 'base';

  /**
   * Returns true if this provider can handle the given booking URL.
   * @param {string} url
   * @returns {boolean}
   */
  canHandle(url) {
    throw new Error('canHandle() not implemented');
  }

  /**
   * Drive the booking form on an already-navigated Playwright page.
   *
   * @param {import('playwright').Page} page – Playwright page already at the booking URL
   * @param {BookingDetails} details
   * @returns {Promise<BookingResult>}
   */
  async book(page, details) {
    throw new Error('book() not implemented');
  }
}

/**
 * @typedef {Object} BookingDetails
 * @property {string} date        – ISO date string, e.g. "2026-03-15"
 * @property {string} time        – 24-h time, e.g. "19:00"
 * @property {number} partySize
 * @property {string} name
 * @property {string} email
 * @property {string} phone
 * @property {string} [specialRequests]
 * @property {string} bookingUrl  – full URL of the restaurant's booking page
 */

/**
 * @typedef {Object} BookingResult
 * @property {boolean} success
 * @property {string}  [confirmationCode]
 * @property {string}  [message]           – human-readable summary
 * @property {Object}  [raw]               – any extra data from the page
 */
