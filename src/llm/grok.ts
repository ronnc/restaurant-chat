import OpenAI from 'openai';
import type { ChatMessage } from '../types.js';
import type { LLMProvider, ProviderConfig } from './types.js';

export class GrokProvider implements LLMProvider {
  readonly name = 'grok';
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      baseURL: config.baseUrl || process.env.GROK_BASE_URL || 'https://api.x.ai/v1',
      apiKey: config.apiKey || process.env.XAI_API_KEY,
    });
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];
    console.log(`[llm:grok] → model=${this.model} messages=${llmMessages.length} system=${systemPrompt.length}chars`);
    console.log(`[llm:grok] → last user: ${messages[messages.length - 1]?.content?.slice(0, 200)}`);
    const start = Date.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: llmMessages,
    });
    const reply = completion.choices[0]?.message?.content || '';
    const elapsed = Date.now() - start;
    console.log(`[llm:grok] ← ${elapsed}ms ${reply.length}chars finish=${completion.choices[0]?.finish_reason} tokens=${completion.usage?.total_tokens ?? '?'}`);
    console.log(`[llm:grok] ← reply: ${reply.slice(0, 300)}${reply.length > 300 ? '...' : ''}`);
    return reply;
  }
}
