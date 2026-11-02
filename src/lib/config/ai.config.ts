import { registerAs } from '@nestjs/config';

export const AI_PROVIDERS = ['openai', 'gemini', 'ollama'] as const;
export type AiConfigProvider = (typeof AI_PROVIDERS)[number];

export default registerAs('Ai', () => ({
  /**
   * Fallback provider used when an `ai_models` row has no provider set.
   * Actual API keys (GEMINI_API_KEY / OPENAI_API_KEY / OLLAMA_*) are read
   * directly by the provider strategies.
   */
  DefaultProvider: process.env.AI_DEFAULT_PROVIDER || 'openai',
  /** Quota fallback when a user has no active subscription row. */
  FreeDailyActions: Number(process.env.FREE_DAILY_AI_ACTIONS) || 30,
}));
