import type { Mock } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AiStreamChunk } from '../../ai';
import { AiProviderType, type IAiService, type AiCompleteResponse } from '../../ai';
import type { IQuotaService, QuotaReservation } from '../../quota';
import { ChatService } from './chat.service';

const RESERVATION: QuotaReservation = {
  usageId: 'usage-1',
  route: {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'gemini',
    providerModel: 'gemini-2.5-flash',
  },
  tier: 'free',
  action: 'chat',
};

function aiResponse(overrides: Partial<AiCompleteResponse['usage']> = {}): AiCompleteResponse {
  return {
    requestId: 'r1',
    type: 'COMPLETE',
    metadata: {
      userId: 'u1',
      model: 'gemini-2.5-flash',
      role: 'assistant',
      timestamp: 0,
      userMessageId: 'u',
      aiMessageId: 'a',
    },
    content: { text: 'Here is how you sauté onions.', images: [] },
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, ...overrides },
  };
}

function metadataChunk(model: string): AiStreamChunk {
  return {
    requestId: 'r1',
    type: 'STREAMED_METADATA',
    sequence: 0,
    lastChunk: false,
    content: {
      userId: 'u1',
      model,
      role: 'assistant',
      timestamp: 0,
      userMessageId: 'u',
      aiMessageId: 'a',
    },
  };
}

function textChunk(text: string, sequence: number): AiStreamChunk {
  return {
    requestId: 'r1',
    type: 'STREAMED_TEXT',
    sequence,
    lastChunk: false,
    content: text,
  };
}

const IMAGE_CHUNK: AiStreamChunk = {
  requestId: 'r1',
  type: 'STREAMED_IMAGE',
  sequence: 99,
  lastChunk: false,
  content: { url: 'https://example.test/image.png', alt: 'garnish' },
};

function chunkStream(chunks: AiStreamChunk[]): AsyncGenerator<AiStreamChunk, void, unknown> {
  return (async function* () {
    yield* chunks;
  })();
}

describe('ChatService', () => {
  let aiService: { generateChat: Mock; generateStream: Mock };
  let quota: { reserve: Mock; complete: Mock; release: Mock };
  let config: { get: Mock };
  let service: ChatService;

  beforeEach(() => {
    aiService = { generateChat: vi.fn().mockResolvedValue(aiResponse()), generateStream: vi.fn() };
    quota = {
      reserve: vi.fn().mockResolvedValue(RESERVATION),
      complete: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    config = { get: vi.fn().mockReturnValue(undefined) };
    service = new ChatService(
      config as unknown as ConfigService,
      aiService as unknown as IAiService,
      quota as unknown as IQuotaService,
    );
  });

  it('prepends the system prompt to the client history and calls the resolved provider', async () => {
    const signal = new AbortController().signal;

    const result = await service.sendMessage({
      userId: 'u1',
      signal,
      sessionId: 'session-1',
      messages: [
        { role: 'user', content: 'How do I caramelize onions?' },
        { role: 'assistant', content: 'Low and slow.' },
        { role: 'user', content: 'How long?' },
      ],
    });

    expect(quota.reserve).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'chat',
      modelId: undefined,
    });
    const [provider, messages, options] = aiService.generateChat.mock.calls[0];
    expect(provider).toBe('gemini' as AiProviderType);
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Augmented Cooking assistant');
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'How do I caramelize onions?' },
      { role: 'assistant', content: 'Low and slow.' },
      { role: 'user', content: 'How long?' },
    ]);
    expect(options.model).toBe('gemini-2.5-flash');
    expect(options.signal).toBe(signal);

    expect(quota.complete).toHaveBeenCalledWith({
      reservation: RESERVATION,
      model: 'gemini-2.5-flash',
      promptTokens: 100,
      completionTokens: 20,
    });
    expect(result).toEqual({
      text: 'Here is how you sauté onions.',
      modelId: RESERVATION.route.id,
      reply: 'Here is how you sauté onions.',
      tokensUsed: 120,
    });
  });

  it('caps the client-supplied history at the last 40 turns', async () => {
    const turns = Array.from({ length: 45 }, (_, i) => ({
      role: 'user' as const,
      content: `turn ${i}`,
    }));

    await service.sendMessage({
      userId: 'u1',
      signal: new AbortController().signal,
      sessionId: 'session-1',
      messages: turns,
    });

    const [, messages] = aiService.generateChat.mock.calls[0];
    expect(messages).toHaveLength(41); // system + last 40
    expect(messages[1].content).toBe('turn 5');
    expect(messages[40].content).toBe('turn 44');
  });

  it('falls back to gemini when the catalog route has the "default" provider placeholder', async () => {
    quota.reserve.mockResolvedValue({
      ...RESERVATION,
      route: { ...RESERVATION.route, provider: 'default', providerModel: undefined },
    });

    await service.sendMessage({
      userId: 'u1',
      signal: new AbortController().signal,
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const [provider, , options] = aiService.generateChat.mock.calls[0];
    expect(provider).toBe('gemini' as AiProviderType);
    expect(options.provider).toBeUndefined();
    expect(options.requestId).toMatch(/^chat-session-1-\d+$/);
  });

  it('honors AI_DEFAULT_PROVIDER for the "default" placeholder instead of hardcoding gemini', async () => {
    config.get.mockReturnValue('openai');
    quota.reserve.mockResolvedValue({
      ...RESERVATION,
      route: { ...RESERVATION.route, provider: 'default', providerModel: undefined },
    });

    await service.sendMessage({
      userId: 'u1',
      signal: new AbortController().signal,
      sessionId: 'session-1',
      messages: [{ role: 'user', content: 'hi' }],
    });

    const [provider] = aiService.generateChat.mock.calls[0];
    expect(provider).toBe('openai' as AiProviderType);
  });

  it('releases the reservation and rethrows when the provider fails', async () => {
    aiService.generateChat.mockRejectedValue(new Error('Gemini Generation Failed: down'));

    await expect(
      service.sendMessage({
        userId: 'u1',
        signal: new AbortController().signal,
        sessionId: 'session-1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow('down');

    expect(quota.complete).not.toHaveBeenCalled();
    expect(quota.release).toHaveBeenCalledWith(RESERVATION);
  });

  it('still throws the original provider error when releasing the reservation fails', async () => {
    aiService.generateChat.mockRejectedValue(new Error('provider down'));
    quota.release.mockRejectedValue(new Error('release failed'));

    await expect(
      service.sendMessage({
        userId: 'u1',
        signal: new AbortController().signal,
        sessionId: 'session-1',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow('provider down');
  });

  describe('streamChat', () => {
    const streamParams = {
      userId: 'u1',
      signal: new AbortController().signal,
      sessionId: 'session-1',
      messages: [{ role: 'user' as const, content: 'How do I caramelize onions?' }],
    };

    it('reserves quota, echoes the resolved model id and streams only text fragments', async () => {
      aiService.generateStream.mockReturnValue(
        chunkStream([
          metadataChunk('gemini-2.5-flash'),
          textChunk('Stir ', 1),
          IMAGE_CHUNK,
          textChunk('constantly.', 2),
          textChunk('', 3), // strategies close with an empty final chunk
        ]),
      );

      const { modelId, stream } = await service.streamChat(streamParams);

      expect(quota.reserve).toHaveBeenCalledWith({
        userId: 'u1',
        action: 'chat',
        modelId: undefined,
      });
      expect(modelId).toBe(RESERVATION.route.id);

      const fragments: string[] = [];
      for await (const fragment of stream) {
        fragments.push(fragment);
      }
      // The generator body runs lazily — the AI call happens on consumption.
      expect(aiService.generateStream).toHaveBeenCalledWith(
        'gemini',
        expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          { role: 'user', content: 'How do I caramelize onions?' },
        ]),
        expect.objectContaining({ model: 'gemini-2.5-flash', signal: streamParams.signal }),
      );
      expect(fragments).toEqual(['Stir ', 'constantly.']);
    });

    it('completes the quota after the last fragment, capturing the model from the stream metadata', async () => {
      aiService.generateStream.mockReturnValue(
        chunkStream([metadataChunk('gemini-2.5-flash'), textChunk('Stir constantly.', 1)]),
      );

      const { stream } = await service.streamChat(streamParams);
      for await (const fragment of stream) {
        expect(fragment).toBe('Stir constantly.');
      }

      expect(quota.complete).toHaveBeenCalledTimes(1);
      const completeCall = quota.complete.mock.calls[0][0];
      expect(completeCall.reservation).toBe(RESERVATION);
      expect(completeCall.model).toBe('gemini-2.5-flash');
      // Chunks carry no usage: tokens are estimated (~4 chars per token).
      expect(completeCall.completionTokens).toBe(Math.ceil('Stir constantly.'.length / 4));
      expect(completeCall.promptTokens).toBeGreaterThan(0);
    });

    it('falls back to the configured provider when the route carries the "default" placeholder', async () => {
      config.get.mockReturnValue('openai');
      quota.reserve.mockResolvedValue({
        ...RESERVATION,
        route: { ...RESERVATION.route, provider: 'default', providerModel: undefined },
      });
      aiService.generateStream.mockReturnValue(chunkStream([textChunk('ok', 1)]));

      const { stream } = await service.streamChat(streamParams);
      for await (const fragment of stream) {
        void fragment;
      }

      const [provider, , options] = aiService.generateStream.mock.calls[0];
      expect(provider).toBe('openai' as AiProviderType);
      expect(options.provider).toBeUndefined();
    });

    it('releases the reservation and rethrows when the provider stream fails mid-stream', async () => {
      aiService.generateStream.mockReturnValue(
        (async function* () {
          yield textChunk('partial ', 1);
          throw new Error('Gemini Streaming Failed: down');
        })(),
      );

      const { stream } = await service.streamChat(streamParams);

      await expect(async () => {
        for await (const fragment of stream) {
          void fragment;
        }
      }).rejects.toThrow('Gemini Streaming Failed: down');

      expect(quota.complete).not.toHaveBeenCalled();
      expect(quota.release).toHaveBeenCalledWith(RESERVATION);
    });

    it('releases the reservation when the generation is aborted (client disconnect)', async () => {
      aiService.generateStream.mockReturnValue(
        (async function* () {
          yield textChunk('partial ', 1);
          throw new Error('This operation was aborted');
        })(),
      );

      const { stream } = await service.streamChat(streamParams);

      await expect(async () => {
        for await (const fragment of stream) {
          void fragment;
        }
      }).rejects.toThrow('aborted');

      expect(quota.complete).not.toHaveBeenCalled();
      expect(quota.release).toHaveBeenCalledWith(RESERVATION);
    });
  });
});
