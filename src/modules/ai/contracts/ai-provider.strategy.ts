import {
  AiProviderType,
  AiRequestOptions,
  AiCompleteResponse,
  AiStreamChunk,
  ChatMessage,
} from '../types';

export abstract class AiProviderStrategy {
  abstract readonly providerId: AiProviderType;

  abstract generateChat(
    messages: ChatMessage[],
    options?: AiRequestOptions,
  ): Promise<AiCompleteResponse>;

  abstract generateStream(
    messages: ChatMessage[],
    options?: AiRequestOptions,
  ): AsyncGenerator<AiStreamChunk, void, unknown>;
}
