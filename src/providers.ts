import { LLMResponse } from './types';

/**
 * AnthropicProvider implements the Anthropic API logic.
 */
export class AnthropicProvider {
  constructor(private apiKey: string, private model: string) {}

  async callAPI(history: any[]): Promise<LLMResponse> {
    console.log(`[Anthropic] Calling ${this.model}...`);
    return {
      text: "Anthropic response",
      toolCalls: []
    };
  }
}

/**
 * OllamaProvider implements the OpenAI-compatible API logic.
 */
export class OllamaProvider {
  constructor(private baseUrl: string, private model: string) {}

  async callAPI(history: any[]): Promise<LLMResponse> {
    console.log(`[Ollama] Calling ${this.baseUrl}...`);
    return {
      text: "Ollama response",
      toolCalls: []
    };
  }
}
