import { Injectable, Inject } from '@nestjs/common';
import {
  ChatMessage,
  AiRequestOptions,
  AiProviderType,
  AiCompleteResponse,
  AiStreamChunk,
} from '../types';
import type { IAiService, IAiStrategyRegistry } from '../interfaces';
import { AI_STRATEGY_REGISTRY_TOKEN } from '../constants';

@Injectable()
export class AiService implements IAiService {
  constructor(
    @Inject(AI_STRATEGY_REGISTRY_TOKEN)
    private readonly registry: IAiStrategyRegistry,
  ) {}

  async generateChat(
    provider: AiProviderType,
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): Promise<AiCompleteResponse> {
    return this.registry.getOrThrow(provider).generateChat(messages, options);
  }

  async *generateStream(
    provider: AiProviderType,
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): AsyncGenerator<AiStreamChunk, void, unknown> {
    yield* this.registry.getOrThrow(provider).generateStream(messages, options);
  }
}
