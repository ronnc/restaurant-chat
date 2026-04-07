import { BaseProvider } from './base';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';

export type ProviderType = 'anthropic' | 'openai' | 'ollama';

export class ProviderFactory {
  static createProvider(type: ProviderType, config: any): BaseProvider {
    switch (type) {
      case 'anthropic':
        return new AnthropicProvider(config.apiKey, config.model);
      case 'openai':
        return new OpenAIProvider(config.apiKey, config.model);
      case 'ollama':
        return new OllamaProvider(config.baseUrl, config.model);
      default:
        throw new Error(`Unsupported provider type: ${type}`);
    }
  }
}
