import type { LLMProvider, ProviderConfig } from './types.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import { GrokProvider } from './grok.js';

type ProviderConstructor = new (config: ProviderConfig) => LLMProvider;

/** Map of provider name → class. */
const PROVIDERS: Record<string, ProviderConstructor> = {
  ollama: OllamaProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  groq: GroqProvider,
  grok: GrokProvider,
};

/** Model prefix → provider name (for auto-detection). */
const MODEL_PREFIXES: [string, string][] = [
  ['gpt', 'openai'],
  ['o1', 'openai'],
  ['o3', 'openai'],
  ['o4', 'openai'],
  ['claude', 'anthropic'],
  ['grok', 'grok'],
  ['llama', 'groq'],
  ['mistral', 'groq'],
  ['qwen', 'groq'],
];

export class ProviderFactory {
  /**
   * Create an LLM provider from a model name.
   *
   * If `providerName` is given explicitly, use that.
   * Otherwise, auto-detect from the model name prefix.
   * Falls back to Ollama if no match.
   */
  static create(model: string, providerName?: string): LLMProvider {
    // Explicit provider
    if (providerName) {
      const Ctor = PROVIDERS[providerName];
      if (!Ctor) throw new Error(`Unknown LLM provider: ${providerName}`);
      return new Ctor({ model });
    }

    // Ollama models typically have a colon tag (e.g. "llama3.1:8b") — default to Ollama
    if (model.includes(':')) {
      return new OllamaProvider({ model });
    }

    // Auto-detect from model name
    const lower = model.toLowerCase();
    for (const [prefix, name] of MODEL_PREFIXES) {
      if (lower.startsWith(prefix.toLowerCase())) {
        return new PROVIDERS[name]!({ model });
      }
    }

    // Default to Ollama
    return new OllamaProvider({ model });
  }

  /** List registered provider names. */
  static get providers(): string[] {
    return Object.keys(PROVIDERS);
  }
}
