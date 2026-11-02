import type { Mock } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AiUnavailableException } from '@exceptions/index';
import type { AiRequestOptions } from '../types';
import { OllamaStrategy } from './ollama.strategy';

vi.mock('openai', () => ({ default: vi.fn() }));

import OpenAI from 'openai';

const MockOpenAI = OpenAI as unknown as Mock;

function options(overrides: Partial<AiRequestOptions> = {}): AiRequestOptions {
  return { userId: 'u1', requestId: 'r1', signal: new AbortController().signal, ...overrides };
}

function config(): ConfigService {
  return {
    get: vi.fn((key: string) =>
      key === 'OLLAMA_BASE_URL'
        ? 'http://127.0.0.1:11434/v1'
        : key === 'OLLAMA_API_KEY'
          ? 'ollama-key'
          : undefined,
    ),
  } as unknown as ConfigService;
}

describe('OllamaStrategy', () => {
  let create: Mock;
  let strategy: OllamaStrategy;

  beforeEach(() => {
    MockOpenAI.mockClear();
    create = vi.fn();
    // Regular function: Vitest applies `new` to the implementation directly,
    // and arrow functions are not constructible.
    MockOpenAI.mockImplementation(function () {
      return { chat: { completions: { create } } };
    });
    strategy = new OllamaStrategy(config());
  });

  it('points the OpenAI-compatible SDK at the Ollama endpoint', () => {
    expect(MockOpenAI).toHaveBeenCalledWith({
      baseURL: 'http://127.0.0.1:11434/v1',
      apiKey: 'ollama-key',
    });
  });

  it('fails fast when OLLAMA_BASE_URL is not configured instead of targeting the OpenAI cloud', async () => {
    const unconfigured = new OllamaStrategy({
      get: vi.fn((key: string) => (key === 'OLLAMA_API_KEY' ? 'ollama-key' : undefined)),
    } as unknown as ConfigService);

    const error = await unconfigured
      .generateChat([{ role: 'user', content: 'q' }], options())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiUnavailableException);
    expect((error as Error).message).toContain('OLLAMA_BASE_URL');
    expect(create).not.toHaveBeenCalled();
  });

  it('sends chat completions against the configured model with strict JSON schema support', async () => {
    create.mockResolvedValue({
      model: 'llama3',
      choices: [{ message: { content: '{"answer":"yes"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const schema = { type: 'object' } as Record<string, unknown>;

    const response = await strategy.generateChat(
      [{ role: 'user', content: 'q' }],
      options({
        responseSchema: { title: 'RESPONSE', schema },
      }),
    );

    const [parameters] = create.mock.calls[0];
    expect(parameters).toMatchObject({
      model: 'llama3',
      messages: [{ role: 'user', content: 'q' }],
      stream: false,
    });
    expect(parameters.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'RESPONSE', strict: true, schema },
    });
    expect(response.content.text).toBe('{"answer":"yes"}');
    expect(response.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
  });

  it('maps provider failures to AiUnavailableException', async () => {
    create.mockRejectedValue(new Error('ECONNREFUSED'));

    const error = await strategy.generateChat([], options()).catch((caught) => caught);

    expect(error).toBeInstanceOf(AiUnavailableException);
    expect(error.message).toBe('Local OpenAI Generation Failed: ECONNREFUSED');
  });

  it('streams deltas and closes with a last chunk', async () => {
    async function* deltas() {
      yield { choices: [{ delta: { content: 'ok' } }] };
    }
    create.mockResolvedValue(deltas());

    const chunks: Array<{ type: string; content?: unknown; lastChunk?: boolean }> = [];
    for await (const chunk of strategy.generateStream([], options())) {
      chunks.push(chunk as { type: string });
    }

    expect(chunks[0].type).toBe('STREAMED_METADATA');
    expect(chunks[chunks.length - 1].lastChunk).toBe(true);
  });
});
