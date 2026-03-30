import type { Page } from 'playwright';

// --- Restaurant config ---

export interface RestaurantConfig {
  name: string;
  tagline?: string;
  emoji?: string;
  cuisine?: string;
  currency?: string;
  knowledge?: string;
}

// --- Booking types ---

export interface BookingDetails {
  date: string;          // ISO date, e.g. "2026-03-15"
  time: string;          // 24-h time, e.g. "19:00"
  partySize: number;
  name: string;
  email: string;
  phone: string;
  specialRequests?: string;
  bookingUrl: string;    // full URL of the restaurant's booking page
}

export interface BookingResult {
  success: boolean;
  confirmationCode?: string;
  message?: string;       // human-readable summary
  raw?: Record<string, unknown>;
}

// --- Chat types ---

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  sessionId: string;
  message: string;
}

export interface ChatResponse {
  reply: string;
  bookingPending?: {
    date: string;
    time: string;
    partySize: number;
    name: string;
    email: string;
    phone: string;
    specialRequests: string;
  };
  /** Present when a live availability lookup ran (SevenRooms). */
  availabilityLookup?: {
    date: string;
    partySize: number;
    slotCount: number;
  };
}

export interface BookRequest {
  bookingUrl: string;
  date: string;
  time: string;
  partySize: number | string;
  name: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

// --- Provider interface ---

export interface IBookingProvider {
  name: string;
  canHandle(url: string): boolean;
  book(page: Page, details: BookingDetails): Promise<BookingResult>;
}
