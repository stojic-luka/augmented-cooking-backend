import type { Mock } from 'vitest';
import { z } from 'zod';
import type { ConfigService } from '@nestjs/config';
import type { IAiService } from '../interfaces';
import type { AiCompleteResponse, AiRequestOptions } from '../types';
import { AiResponseInvalidException, AiUnavailableException } from '@exceptions/index';
import { AiJsonService } from './ai-json.service';

const RESPONSE_SCHEMA = {
  title: 'RESPONSE',
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
};

const parse = (value: unknown) => z.object({ answer: z.string() }).parse(value);

function completeResponse(text: string, tokens = 5): AiCompleteResponse {
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
    content: { text, images: [] },
    usage: { promptTokens: tokens, completionTokens: tokens, totalTokens: tokens * 2 },
  };
}

function baseOptions(): AiRequestOptions {
  return { userId: 'u1', requestId: 'r1', signal: new AbortController().signal };
}

describe('AiJsonService.generateValidated', () => {
  let generateChat: Mock;
  let config: { get: Mock };
  let service: AiJsonService;

  beforeEach(() => {
    generateChat = vi.fn();
    config = { get: vi.fn().mockReturnValue('gemini') };
    service = new AiJsonService(
      {
        generateChat,
        generateStream: vi.fn(),
      } as unknown as IAiService,
      config as unknown as ConfigService,
    );
  });

  function params(options = baseOptions()) {
    return {
      options,
      systemPrompt: 'SYSTEM',
      userPrompt: 'USER',
      jsonSchema: RESPONSE_SCHEMA,
      parse,
    };
  }

  it('returns the parsed data on the first valid attempt and passes the schema under the title', async () => {
    generateChat.mockResolvedValue(completeResponse('{"answer":"hi"}'));

    const result = await service.generateValidated(params());

    expect(result.data).toEqual({ answer: 'hi' });
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 5, totalTokens: 10 });
    expect(result.model).toBe('gemini-2.5-flash');
    expect(generateChat).toHaveBeenCalledTimes(1);
    const [, , options] = generateChat.mock.calls[0];
    expect(options.responseSchema).toEqual({
      title: 'RESPONSE',
      schema: RESPONSE_SCHEMA,
    });
  });

  it('strips markdown JSON fences before parsing', async () => {
    generateChat.mockResolvedValue(completeResponse('```json\n{"answer":"hi"}\n```'));

    const result = await service.generateValidated(params());

    expect(result.data).toEqual({ answer: 'hi' });
  });

  it('retries once with a repair prompt when the output is not valid JSON', async () => {
    generateChat
      .mockResolvedValueOnce(completeResponse('not json at all', 3))
      .mockResolvedValueOnce(completeResponse('{"answer":"fixed"}', 4));

    const result = await service.generateValidated(params());

    expect(result.data).toEqual({ answer: 'fixed' });
    expect(result.usage).toEqual({ promptTokens: 7, completionTokens: 7, totalTokens: 14 });
    expect(generateChat).toHaveBeenCalledTimes(2);
    const [system, user] = generateChat.mock.calls[1][1];
    expect(system.role).toBe('system');
    expect(system.content).toContain('RESPONSE');
    expect(user.content).toContain('Output is not valid JSON.');
    expect(user.content).toContain('not json at all');
  });

  it('feeds schema validation problems back into the repair prompt', async () => {
    generateChat
      .mockResolvedValueOnce(completeResponse('{"wrong":"shape"}'))
      .mockResolvedValueOnce(completeResponse('{"answer":"ok"}'));

    await service.generateValidated(params());

    const [, user] = generateChat.mock.calls[1][1];
    expect(user.content).toContain('Invalid input');
  });

  it('throws AiResponseInvalidException after the failed repair round-trip', async () => {
    generateChat.mockResolvedValue(completeResponse('still broken'));

    await expect(service.generateValidated(params())).rejects.toThrow(
      new AiResponseInvalidException(),
    );
    expect(generateChat).toHaveBeenCalledTimes(2);
  });

  it('wraps provider failures in AiUnavailableException without attempting a repair', async () => {
    generateChat.mockRejectedValue(new Error('provider down'));

    await expect(service.generateValidated(params())).rejects.toThrow(
      new AiUnavailableException('provider down'),
    );
    expect(generateChat).toHaveBeenCalledTimes(1);
  });

  it('falls back to the configured default provider when the options carry none', async () => {
    generateChat.mockResolvedValue(completeResponse('{"answer":"hi"}'));

    await service.generateValidated(params());

    expect(config.get).toHaveBeenCalledWith('Ai.DefaultProvider');
    expect(generateChat.mock.calls[0][0]).toBe('gemini');
  });

  it('uses the configured AI_DEFAULT_PROVIDER as the fallback', async () => {
    config.get.mockReturnValue('openai');
    generateChat.mockResolvedValue(completeResponse('{"answer":"hi"}'));

    await service.generateValidated(params());

    expect(generateChat.mock.calls[0][0]).toBe('openai');
  });

  it('defaults to gemini when no default provider is configured', async () => {
    config.get.mockReturnValue(undefined);
    generateChat.mockResolvedValue(completeResponse('{"answer":"hi"}'));

    await service.generateValidated(params());

    expect(generateChat.mock.calls[0][0]).toBe('gemini');
  });

  it('honours an explicit provider from the options', async () => {
    config.get.mockReturnValue('openai');
    generateChat.mockResolvedValue(completeResponse('{"answer":"hi"}'));

    await service.generateValidated(params({ ...baseOptions(), provider: 'ollama' }));

    expect(generateChat.mock.calls[0][0]).toBe('ollama');
  });
});
