import { Conversation, LLMResponse } from '../types';

export abstract class BaseProvider {
  constructor(protected model: string) {}

  /**
   * The core method every provider must implement.
   * @param history The conversation history including system instructions.
   */
  abstract callAPI(history: Conversation[]): Promise<LLMResponse>;
}
