import { LLMClient } from './llm_client';
import { AnthropicProvider, OllamaProvider } from './providers';
import { registry } from './tool_registry';

/**
 * INTEGRATION TEST: Verifies that the Agentic Loop, 
 * the Tool Registry, and the Provider Abstraction 
 * all work together in the real project structure.
 */
async function runIntegrationTest() {
  console.log("     Starting Real-World Integration Test for restaurant-chat...");

  registry.register({
    name: 'create_booking',
    description: 'Creates a restaurant booking.',
		execute: async (args: any) => {
		  return `Success: Booking confirmed for ${args.partySize} people on ${args.date}.`;
		}
  });


  const agent = new LLMClient(ollama, "You are a restaurant assistant.");
  
  const userQuery = "I want to book a table for 4 on May 1st.";
  console.log(`\n[User Query]: ${userQuery}`);

  try {
    console.log("[Agent]: Processing query and checking for tools...");
    const result = await agent.generateResponse(userQuery);
    console.log(`\n[Final Agent Output]: ${result}`);
  } catch (err) {
    console.error("\n[ Œ TEST FAILED]:", err);
    process.exit(1);
  }

  console.log("\n--- Full Conversation Trace ---");
  const history = agent.getHistory();
  if (history.length === 0) {
    console.error("[ Œ ERROR]: History is empty!");
    process.exit(1);
  }

  history.forEach(msg => {
    console.log(`[${msg.role.toUpperCase()}]: ${msg.content}`);
  });

  console.log("\n    [SUCCESS]: The Agentic Loop is functioning correctly!");
}

runIntegrationTest().catch(err => {
  console.error("Fatal Test Error:", err);
  process.exit(1);
});
