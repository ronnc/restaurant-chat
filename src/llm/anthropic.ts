import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage } from '../types.js';
import type { LLMProvider, ProviderConfig } from './types.js';

const MAX_TOKENS = 4096;

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new Anthropic({
      baseURL: config.baseUrl || process.env.ANTHROPIC_BASE_URL,
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    console.log(`[llm:anthropic] → model=${this.model} messages=${messages.length} system=${systemPrompt.length}chars`);
    console.log(`[llm:anthropic] → last user: ${messages[messages.length - 1]?.content?.slice(0, 200)}`);
    const start = Date.now();
    const resp = await this.client.messages.create({
      model: this.model,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });
    const reply = resp.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');
    const elapsed = Date.now() - start;
    console.log(`[llm:anthropic] ← ${elapsed}ms ${reply.length}chars stop=${resp.stop_reason} in=${resp.usage.input_tokens} out=${resp.usage.output_tokens}`);
    console.log(`[llm:anthropic] ← reply: ${reply.slice(0, 300)}${reply.length > 300 ? '...' : ''}`);
    return reply;
  }
}
