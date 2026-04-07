import { Conversation, LLMResponse } from '../types';
import { BaseProvider } from './base';

export class OpenAIProvider extends BaseProvider {
  constructor(private apiKey: string, model: string) {
    super(model);
  }

  async callAPI(history: Conversation[]): Promise<LLMResponse> {
    console.log(`[OpenAI] Calling ${this.model}...`);
    // In a real implementation, this would use the OpenAI SDK
    return {
      text: "OpenAI response",
      toolCalls: []
    };
  }
}

export class OllamaProvider extends BaseProvider {
  constructor(private baseUrl: string, model: string) {
    super(model);
  }

  async callAPI(history: Conversation[]): Promise<LLMResponse> {
    console.log(`[Ollama] Calling ${this.baseUrl}...`);
    // In a real implementation, this would use the Ollama API
    return {
      text: "Ollama response",
      toolCalls: []
    };
  }
}
