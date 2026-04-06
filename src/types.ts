/**
 * Represents a single turn in the conversation history.
 * Matches the Python `Conversation` model.
 */
export interface Conversation {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

/**
 * Represents a structured tool call extracted from an LLM response.
 * This is the "Action" that the Agent loop will execute.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/**
 * Represents the response payload from an LLM provider.
 * This is what the provider-specific implementation returns to the orchestrator.
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
 * The structure of a completed booking, extracted from the agent's tool output.
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
