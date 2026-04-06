import { Conversation, ToolCall, LLMResponse, ILLMProvider } from './types';
import fetch from 'node-fetch';

/**
 * AnthropicProvider implements the real Anthropic Messages API.
 */
export class AnthropicProvider implements ILLMProvider {
  constructor(
    private apiKey: string, 
    private model: string
  ) {}

  async callAPI(history: Conversation[]): Promise<LLMResponse> {
    console.log(`[Anthropic] Calling ${this.model}...`);

    // Transform our Conversation history to Anthropic's message format
    const messages = history
      .filter(h => h.role !== 'system')
      .map(h => ({
        role: h.role === 'tool' ? 'user' : h.role, // Anthropic uses 'user' for tool results in simple flows
        content: h.content
      }));

    const systemPrompt = history.find(h => h.role === 'system')?.content || "";

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API Error: ${response.status} - ${errorText}`);
      }

      const data: any = await response.json();
      
      // Extract text content
      const text = data.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');

      // Extract tool calls (simplified for this implementation)
      const toolCalls: ToolCall[] = [];
      const toolContent = data.content.filter((c: any) -> c.type === 'tool_use');
      
      toolContent.forEach((tc: any) => {
        toolCalls.push({
          id: tc.id,
          name: tc.name,
          arguments: tc.input
        });
      });

      return { text, toolCalls };
    } catch (err: any) {
      console.error("[Anthropic Error]:", err.message);
      throw err;
    }
  }
}

/**
 * OllamaProvider implements the OpenAI-compatible endpoint for local Ollama.
 */
export class OllamaProvider implements ILLMProvider {
  constructor(
    private baseUrl: string, 
    private model: string
  ) {}

  async callAPI(history: Conversation[]): Promise<LLMResponse> {
    console.log(`[Ollama] Calling ${this.baseUrl}/v1/chat/completions...`);

    // Transform our history to OpenAI format
    const messages = history.map(h => ({
      role: h.role === 'tool' ? 'user' : h.role,
      content: h.content
    }));

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API Error: ${response.status} - ${errorText}`);
      }

      const data: any = await response.json();
      const text = data.choices[0].message.content;

      return {
        text: text,
        toolCalls: [] // Ollama tool parsing is complex; keeping it simple for now
      };
    } catch (err: any) {
      console.error("[OMMola Error]:", err.message);
      throw err;
    }
  }
}
