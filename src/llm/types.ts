import type { ChatMessage } from '../types.js';

/**
 * Common interface for all LLM providers.
 * Mirrors the Python BaseLLMClient pattern from chat-client-toy.
 */
export interface LLMProvider {
  /** Provider name for logging, e.g. "ollama", "anthropic" */
  readonly name: string;

  /** Generate a chat completion given a system prompt and message history. */
  chat(messages: ChatMessage[], systemPrompt: string): Promise<string>;
}

/** Config passed to provider constructors. */
export interface ProviderConfig {
  model: string;
  baseUrl?: string;
  apiKey?: string;
}
