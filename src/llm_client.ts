import { Conversation, ToolCall, LLMResponse, ILLMProvider } from './types';
import { AnthropicProvider, OllamaProvider } from './providers';

/**
 * The LLMClient implements the "Agentic Loop" pattern.
 * It is now provider-agnostic, accepting any implementation of ILLMProvider.
 */
export class LLMClient {
  private history: Conversation[] = [];
  private readonly maxRounds: number = 5;

  constructor(
    private provider: ILLMProvider,
    private instructions: string
  ) {
    this.history.push({ role: 'system', content: this.instructions });
  }

  /**
   * The core "Agentic Loop".
   */
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

  private async executeTool(tool: ToolCall): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, 500));
    return `Success: Tool ${tool.name} executed.`;
  }

  public getHistory(): Conversation[] {
    return this.history;
  }
}

/**
 * Test Suite: Demonstrating the decoupled architecture and error resilience.
 */
async function runTest() {
  console.log("     Starting Integrated LLMClient Test...");


  const agent = new LLMClient(ollama, "You are a restaurant assistant.");
  
  const userQuery = "I want to book a table.";
  console.log(`User: ${userQuery}`);

  try {
    const result = await agent.generateResponse(userQuery);
    console.log(`\nFinal Agent Output: ${result}`);
  } catch (e) {
    console.error("Test Fatal Error:", e);
  }

  console.log("\n--- Full Conversation Trace ---");
  agent.getHistory().forEach(msg => {
    console.log(`[${msg.role.toUpperCase()}]: ${msg.content}`);
  });
}

runTest().catch(err => console.error(err));
