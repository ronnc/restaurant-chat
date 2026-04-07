import { Conversation, LLMResponse } from '../types';
import { BaseProvider } from './base';

export class AnthropicProvider extends BaseProvider {
  constructor(private apiKey: string, model: string) {
    super(model);
  }

  async callAPI(history: Conversation[]): Promise<LLMResponse> {
    console.log(`[Anthropic] Calling ${this.model}...`);
    // In a real implementation, this would use the Anthropic SDK
    return {
      text: "Anthropic response",
      toolCalls: []
    };
  }
}
