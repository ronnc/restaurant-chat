import OpenAI from 'openai';
import type { ChatMessage } from '../types.js';
import type { LLMProvider, ProviderConfig } from './types.js';

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      baseURL: config.baseUrl || process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      apiKey: config.apiKey || process.env.GROQ_API_KEY,
    });
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];
    console.log(`[llm:groq] → model=${this.model} messages=${llmMessages.length} system=${systemPrompt.length}chars`);
    console.log(`[llm:groq] → last user: ${messages[messages.length - 1]?.content?.slice(0, 200)}`);
    const start = Date.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: llmMessages,
    });
    const reply = completion.choices[0]?.message?.content || '';
    const elapsed = Date.now() - start;
    console.log(`[llm:groq] ← ${elapsed}ms ${reply.length}chars finish=${completion.choices[0]?.finish_reason} tokens=${completion.usage?.total_tokens ?? '?'}`);
    console.log(`[llm:groq] ← reply: ${reply.slice(0, 300)}${reply.length > 300 ? '...' : ''}`);
    return reply;
  }
}
