import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { AiProviderStrategy } from '../contracts';
import { AI_PROVIDER_STRATEGIES_TOKEN } from '../constants/ai.constants';
import { AiProviderType } from '../types';
import { IAiStrategyRegistry } from '../interfaces';

@Injectable()
export class AiStrategyRegistry implements IAiStrategyRegistry {
  private readonly registry = new Map<AiProviderType, AiProviderStrategy>();

  constructor(
    @Inject(AI_PROVIDER_STRATEGIES_TOKEN)
    strategies: AiProviderStrategy[],
  ) {
    for (const strategy of strategies) {
      this.registry.set(strategy.providerId, strategy);
    }
  }

  public get(provider: AiProviderType): AiProviderStrategy | undefined {
    return this.registry.get(provider);
  }

  public getOrThrow(provider: AiProviderType): AiProviderStrategy {
    const strategy = this.registry.get(provider);
    if (!strategy) {
      const active = Array.from(this.registry.keys()).join(', ');
      throw new BadRequestException(
        `AI Engine "${provider}" is unavailable. Active engines: [${active}]`,
      );
    }
    return strategy;
  }
}
