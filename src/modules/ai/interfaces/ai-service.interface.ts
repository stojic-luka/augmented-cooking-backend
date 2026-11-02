import {
  AiProviderType,
  ChatMessage,
  AiRequestOptions,
  AiCompleteResponse,
  AiStreamChunk,
} from '../types';

export interface IAiService {
  generateChat(
    provider: AiProviderType,
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): Promise<AiCompleteResponse>;

  generateStream(
    provider: AiProviderType,
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): AsyncGenerator<AiStreamChunk, void, unknown>;
}
