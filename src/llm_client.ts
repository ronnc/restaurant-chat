import { Conversation, ToolCall, LLMResponse } from './types';

/**
 * The LLMClient implements the Agentic Loop.
 * It handles history and tool execution.
 */
export class LLMClient {
  private history: Conversation[] = [];
  private readonly maxRounds: number = 5;
  private provider: any;
  private instructions: string;

  constructor(provider: any, instructions: string) {
    this.provider = provider;
    this.instructions = instructions;
    this.history.push({ role: 'system', content: this.instructions });
  }

  public async generateResponse(query: string): Promise<string> {
    this.history.push({ role: 'user', content: query });

    let finalText = "";

    for (let round = 0; round < this.maxRounds; round++) {
      console.log(`\n[Agent Round ${round + 1}] Calling Provider...`);
      
      try {
        const response: LLMResponse = await this.provider.callAPI(this.history);

        if (response.toolCalls && response.toolCalls.length > 0) {
          for (const tool of response.toolCalls) {
            console.log(`[Agent] Tool Detected: ${tool.name} with args:`, tool.arguments);
            
            const toolResult = await this.executeTool(tool);
            
            this.history.push({
              role: 'tool',
              content: toolResult
            });
          }
        } else {
          finalText = response.text;
          this.history.push({ role: 'assistant', content: finalText });
          break;
        }
      } catch (err: any) {
        const errorMsg = `[Provider Error]: ${err.message}`;
        console.error(errorMsg);
        this.history.push({ role: 'assistant', content: errorMsg });
        return errorMsg;
      }
    }

    return finalText;
  }

  private async executeTool(tool: any): Promise<string> {
    // In a real implementation, this would use the registry
    // For the test, we just simulate the tool execution
    return `Success: Tool ${tool.name} executed.`;
  }

  public getHistory(): Conversation[] {
    return this.history;
  }
 
}
