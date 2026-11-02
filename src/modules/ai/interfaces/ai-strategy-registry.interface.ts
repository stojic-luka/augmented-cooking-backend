import { AiProviderType } from '../types';
import { AiProviderStrategy } from '../contracts';

export interface IAiStrategyRegistry {
  get(provider: AiProviderType): AiProviderStrategy | undefined;
  getOrThrow(provider: AiProviderType): AiProviderStrategy;
}
