import type { Mock } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AiUnavailableException } from '@exceptions/index';
import type { AiRequestOptions } from '../types';
import { OpenAiStrategy } from './openai.strategy';

vi.mock('openai', () => ({ default: vi.fn() }));

import OpenAI from 'openai';

const MockOpenAI = OpenAI as unknown as Mock;

function options(overrides: Partial<AiRequestOptions> = {}): AiRequestOptions {
  return { userId: 'u1', requestId: 'r1', signal: new AbortController().signal, ...overrides };
}

function config(): ConfigService {
  return {
    get: vi.fn((key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined)),
  } as unknown as ConfigService;
}

const RESPONSE_SCHEMA = {
  title: 'RESPONSE',
  schema: { type: 'object' } as Record<string, unknown>,
};

describe('OpenAiStrategy', () => {
  let create: Mock;
  let strategy: OpenAiStrategy;

  beforeEach(() => {
    MockOpenAI.mockClear();
    create = vi.fn();
    // Regular function: Vitest applies `new` to the implementation directly,
    // and arrow functions are not constructible.
    MockOpenAI.mockImplementation(function () {
      return { chat: { completions: { create } } };
    });
    strategy = new OpenAiStrategy(config());
  });

  describe('generateChat', () => {
    it('builds the chat-completion request with the configured model and passes the abort signal', async () => {
      create.mockResolvedValue({
        model: 'gpt-4.1-mini',
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
      });

      const response = await strategy.generateChat([{ role: 'user', content: 'hi' }], options());

      expect(MockOpenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
      expect(create).toHaveBeenCalledTimes(1);
      const [parameters, requestInit] = create.mock.calls[0];
      expect(parameters).toMatchObject({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: 'hi' }],
        stream: false,
      });
      expect(requestInit).toEqual({ signal: expect.any(AbortSignal) });

      expect(response.content.text).toBe('hello');
      expect(response.metadata.model).toBe('gpt-4.1-mini');
      expect(response.usage).toEqual({ promptTokens: 3, completionTokens: 5, totalTokens: 8 });
      expect(response.requestId).toBe('r1');
    });

    it('requests strict structured output when a response schema is given', async () => {
      create.mockResolvedValue({
        model: 'gpt-4.1-mini',
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });

      await strategy.generateChat([], options({ responseSchema: RESPONSE_SCHEMA }));

      const [parameters] = create.mock.calls[0];
      expect(parameters.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'RESPONSE',
          strict: true,
          schema: RESPONSE_SCHEMA.schema,
        },
      });
    });

    it('maps provider failures to AiUnavailableException carrying the SDK message', async () => {
      create.mockRejectedValue(new Error('insufficient quota'));

      const error = await strategy.generateChat([], options()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AiUnavailableException);
      expect(error.message).toBe('Local OpenAI Generation Failed: insufficient quota');
    });

    it('defaults usage to zeroes when the provider reports none', async () => {
      create.mockResolvedValue({ model: 'gpt-4.1-mini', choices: [{ message: { content: 'x' } }] });

      const response = await strategy.generateChat([], options());

      expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    });
  });

  describe('generateStream', () => {
    it('yields metadata, then the non-empty deltas, then a closing last chunk', async () => {
      async function* deltas() {
        yield { choices: [{ delta: { content: 'he' } }] };
        yield { choices: [{ delta: { content: '' } }] };
        yield { choices: [{ delta: { content: 'llo' } }] };
      }
      create.mockResolvedValue(deltas());

      const chunks: Array<{ type: string; content?: unknown; lastChunk?: boolean }> = [];
      for await (const chunk of strategy.generateStream([], options())) {
        chunks.push(chunk as { type: string });
      }

      expect(chunks[0].type).toBe('STREAMED_METADATA');
      expect((chunks[0].content as { model: string }).model).toBe('gpt-4.1-mini');
      expect(chunks.filter((c) => c.type === 'STREAMED_TEXT').map((c) => c.content)).toEqual([
        'he',
        'llo',
        '',
      ]);
      expect(chunks[chunks.length - 1].lastChunk).toBe(true);
    });

    it('maps streaming failures to AiUnavailableException', async () => {
      create.mockRejectedValue(new Error('connection reset'));

      const error = await (async () => {
        try {
          for await (const _chunk of strategy.generateStream([], options())) {
            void _chunk;
          }
        } catch (caught) {
          return caught;
        }
        return null;
      })();

      expect(error).toBeInstanceOf(AiUnavailableException);
      expect((error as Error).message).toBe('Local OpenAI Streaming Failed: connection reset');
    });
  });
});
