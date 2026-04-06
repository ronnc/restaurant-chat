import { ToolCall } from './types';

/**
 * Represents a function that can be called by the LLM.
 */
export interface RegisteredTool {
  name: string;
  description: string;
  execute: (args: any) => Promise<string>;
}

/**
 * The ToolRegistry is the central brain for all capabilities.
 * It allows the Agent to "discover" what it can do.
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  constructor() {}

  /**
   * Registers a new tool into the system.
   */
  public register(tool: RegisteredTool): void {
    console.log(`[Registry] Registering tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  /**
   * Executes a tool by name.
   * Throws an error if the tool does not exist.
   */
  public async execute(name: string, args: any): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found in registry.`);
    }

    console.log(`[Registry] Executing '${name}' with args:`, args);
    try {
      return await tool.execute(args);
    } catch (err: any) {
      return `Error executing tool '${name}': ${err.message}`;
    }
  }

  /**
   * Returns a list of all registered tool names and descriptions.
   * This is what we will eventually inject into the LLM's system prompt.
   */
  public getToolDefinitions(): string {
    let defs = "Available tools:\n";
    this.tools.forEach((tool) => {
      defs += `- ${tool.name}: ${tool.description}\n`;
    });
    return defs;
  }
}

// Singleton instance for easy access across the application
export const registry = new ToolRegistry();
