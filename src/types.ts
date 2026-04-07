import { Conversation, ToolCall, LLMResponse, BookingResult } from './types';

/**
 * Represents a single turn in the conversation history.
 */
export interface Conversation {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

/**
 * Represents a structured tool call extracted from an LLM response.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Represents the response payload from an LLM provider.
 */
export interface LLMResponse {
  text: string;
  toolCalls?: ToolCall[];
}

/**
 * The configuration for the LLM provider.
 */
export interface ProviderConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * The structure of a completed booking.
 */
export interface BookingResult {
  action: 'book';
  date: string;
  time: string;
  partySize: number;
  name: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

/**
 * Request structure for the /api/chat endpoint.
 */
export interface ChatRequest {
  sessionId: string;
  message: string;
}

/**
 * Response structure for the /api/chat endpoint.
 */
export interface ChatResponse {
  reply: string;
  availabilityLookup?: {
    date: string;
    partySize: number;
    slotCount: number;
  };
}

/**
 * Request structure for the /api/book endpoint.
 */
export interface BookRequest {
  bookingUrl: string;
  date: string;
  time: string;
  party_size: number;
  name: string;
  email: string;
  phone: string;
  specialRequests?: string;
}

/**
 * Configuration for the Restaurant.
 */
export interface RestaurantConfig {
  name: string;
  cuisine?: string;
  currency?: string;
  tagline?: string;
  knowledge?: string;
  place_id?: string;
  address?: string;
}
