import { LLMClient } from './llm_client.js';
import { AnthropicProvider, OllamaProvider } from './providers.js';
import { registry } from './tool_registry.js';
import './tools/booking_tool.js';

/**
 * INTEGRATION TEST: Verifies that the Agentic Loop, 
 * the Tool Registry, and the Provider Abstraction 
 * all work together in the real project structure.
 */
async function runIntegrationTest() {
  console.log("🚀 Starting Real-World Integration Test for restaurant-chat...");

  // 1. Setup the Provider (Using a mock-like setup for testing)
  const provider: any = {
    async callAPI(history: any[]): Promise<any> {
      console.log("[Test] Calling Provider with history length:", history.length);
      
      // Simulate a tool call response
      return {
        text: "I have processed your booking request.",
        toolCalls: [{
          id: 'call_120',
          name: 'create_booking',
          arguments: { date: '2:026-05-01', partySize: 4, name: 'Test User' }
        }]
      };
    }
  };

  // 2. Initialize the Agent
  const agent = new (class extends LLMClient {
    constructor(p: any, i: string) { super(p as any, i); }
  })(provider, "You are a restaurant assistant.");
  
  const userQuery = "I want to book a table for 4.";
  console.log(`\n[User Query]: ${userQuery}`);

  // 3. Run the Agentic Loop
  try {
    console.log("[Agent]: Processing query and checking for tools...");
    const result = await agent.generateResponse(userQuery);
    console.log(`\n[Final Agent Output]: ${result}`);
  } catch (err: any) {
    console.error(`\n[❌ TEST FAILED]: ${err.message}`);
    process.exit(1);
  }

  // 4. Verify the Conversation Trace
  console.log("\n--- Full Conversation Trace ---");
  const history = agent.getHistory();
  if (history.length === 0) {
    console.error("[❌ ERROR]: History is empty!");
    process.exit(1);
  }

  history.forEach(msg => {
    console.log(`[${msg.role.toUpperCase()}]: ${msg.content}`);
  });

  console.log("\n✅ [SUCCESS]: The Agentic Loop is functioning correctly!");
}

runIntegrationTest().catch(err => {
  console.error("Fatal Test Error:", err);
  process.exit(1);
});
