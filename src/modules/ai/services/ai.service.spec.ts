import type { IAiStrategyRegistry } from '../interfaces';
import type {
  AiCompleteResponse,
  AiProviderType,
  AiRequestOptions,
  AiStreamChunk,
  ChatMessage,
} from '../types';
import { AiService } from './ai.service';

describe('AiService', () => {
  const strategy = {
    generateChat: vi.fn(),
    generateStream: vi.fn(),
  };
  const registry: IAiStrategyRegistry = {
    get: vi.fn(),
    getOrThrow: vi.fn().mockReturnValue(strategy),
  };
  const service = new AiService(registry);

  const options: AiRequestOptions = {
    userId: 'u1',
    requestId: 'r1',
    signal: new AbortController().signal,
  };

  it('routes generateChat to the strategy resolved from the registry', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    const response = { type: 'COMPLETE' } as AiCompleteResponse;
    strategy.generateChat.mockResolvedValue(response);

    const result = await service.generateChat('openai' as AiProviderType, messages, options);

    expect(registry.getOrThrow).toHaveBeenCalledWith('openai');
    expect(strategy.generateChat).toHaveBeenCalledWith(messages, options);
    expect(result).toBe(response);
  });

  it('routes generateStream through the resolved strategy', async () => {
    const chunk = { type: 'STREAMED_TEXT', content: 'x' } as AiStreamChunk;
    strategy.generateStream.mockImplementation(async function* () {
      yield chunk;
    });

    const chunks: AiStreamChunk[] = [];
    for await (const c of service.generateStream('gemini' as AiProviderType, [], options)) {
      chunks.push(c);
    }

    expect(chunks).toEqual([chunk]);
  });
});
