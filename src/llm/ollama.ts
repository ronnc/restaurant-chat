import OpenAI from 'openai';
import type { ChatMessage } from '../types.js';
import type { LLMProvider, ProviderConfig } from './types.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.model = config.model;
    this.client = new OpenAI({
      baseURL: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
      apiKey: config.apiKey || 'ollama',
    });
  }

  async chat(messages: ChatMessage[], systemPrompt: string): Promise<string> {
    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];
    console.log(`[llm:ollama] → model=${this.model} messages=${llmMessages.length} system=${systemPrompt.length}chars`);
    console.log(`[llm:ollama] → last user: ${messages[messages.length - 1]?.content?.slice(0, 200)}`);
    const start = Date.now();
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: llmMessages,
    });
    const reply = completion.choices[0]?.message?.content || '';
    const elapsed = Date.now() - start;
    console.log(`[llm:ollama] ← ${elapsed}ms ${reply.length}chars finish=${completion.choices[0]?.finish_reason}`);
    console.log(`[llm:ollama] ← reply: ${reply.slice(0, 300)}${reply.length > 300 ? '...' : ''}`);
    return reply;
  }
}
