import type { Mock } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { AiUnavailableException } from '../../../common/exceptions/index';
import type { AiRequestOptions, ChatMessage } from '../types';
import { GeminiStrategy } from './gemini.strategy';

vi.mock('@google/genai', () => ({ GoogleGenAI: vi.fn() }));

import { GoogleGenAI } from '@google/genai';

const MockGoogleGenAI = GoogleGenAI as unknown as Mock;

function options(overrides: Partial<AiRequestOptions> = {}): AiRequestOptions {
  return { userId: 'u1', requestId: 'r1', signal: new AbortController().signal, ...overrides };
}

function config(): ConfigService {
  return {
    get: vi.fn((key: string) => (key === 'GEMINI_API_KEY' ? 'test-key' : undefined)),
  } as unknown as ConfigService;
}

describe('GeminiStrategy', () => {
  let generateContent: Mock;
  let generateContentStream: Mock;
  let strategy: GeminiStrategy;

  beforeEach(() => {
    MockGoogleGenAI.mockClear();
    generateContent = vi.fn();
    generateContentStream = vi.fn();
    // Regular function: Vitest applies `new` to the implementation directly,
    // and arrow functions are not constructible.
    MockGoogleGenAI.mockImplementation(function () {
      return { models: { generateContent, generateContentStream } };
    });
    strategy = new GeminiStrategy(config());
  });

  describe('generateChat', () => {
    it('maps system/user/assistant roles onto Gemini contents and systemInstruction', async () => {
      generateContent.mockResolvedValue({
        modelVersion: 'gemini-2.5-flash',
        text: 'answer',
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4, totalTokenCount: 6 },
      });
      const messages: ChatMessage[] = [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ];
      const requestOptions = options();

      const response = await strategy.generateChat(messages, requestOptions);

      expect(MockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
      const [parameters] = generateContent.mock.calls[0];
      expect(parameters.model).toBe('gemini-2.5-flash');
      expect(parameters.contents).toEqual([
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hello' }] },
      ]);
      expect(parameters.config.systemInstruction).toBe('be nice');
      expect(parameters.config.abortSignal).toBe(requestOptions.signal);

      expect(response.content.text).toBe('answer');
      expect(response.usage).toEqual({ promptTokens: 2, completionTokens: 4, totalTokens: 6 });
    });

    it('falls back to prompt+completion when the provider omits totalTokenCount', async () => {
      generateContent.mockResolvedValue({
        modelVersion: 'gemini-2.5-flash',
        text: 'answer',
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 },
      });

      const response = await strategy.generateChat([], options());

      expect(response.usage.totalTokens).toBe(6);
    });

    it('requests JSON output when a response schema is given', async () => {
      generateContent.mockResolvedValue({ modelVersion: 'm', text: '{}', usageMetadata: {} });
      const schema = { type: 'object' } as Record<string, unknown>;

      await strategy.generateChat([], options({ responseSchema: { title: 'X', schema } }));

      const [parameters] = generateContent.mock.calls[0];
      expect(parameters.config.responseMimeType).toBe('application/json');
      expect(parameters.config.responseJsonSchema).toBe(schema);
    });

    it('maps provider failures to AiUnavailableException', async () => {
      generateContent.mockRejectedValue(new Error('safety block'));

      const error = await strategy.generateChat([], options()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AiUnavailableException);
      expect(error.message).toBe('Gemini Generation Failed: safety block');
    });
  });

  describe('generateStream', () => {
    it('yields metadata, deltas and always closes with a last chunk', async () => {
      async function* chunks() {
        yield { text: 'a' };
        yield { text: undefined };
        yield { text: 'b' };
      }
      generateContentStream.mockResolvedValue(chunks());

      const collected: Array<{ type: string; content?: unknown; lastChunk?: boolean }> = [];
      for await (const chunk of strategy.generateStream([], options())) {
        collected.push(chunk as { type: string });
      }

      expect(collected[0].type).toBe('STREAMED_METADATA');
      expect(collected.filter((c) => c.type === 'STREAMED_TEXT').map((c) => c.content)).toEqual([
        'a',
        'b',
        '',
      ]);
      expect(collected[collected.length - 1].lastChunk).toBe(true);
    });

    it('still emits the closing chunk when the stream fails before the first delta', async () => {
      generateContentStream.mockRejectedValue(new Error('boom'));

      const collected: Array<{ type: string; lastChunk?: boolean }> = [];
      let error: unknown = null;
      try {
        for await (const chunk of strategy.generateStream([], options())) {
          collected.push(chunk as { type: string });
        }
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AiUnavailableException);
      expect((error as Error).message).toBe('Gemini Streaming Failed: boom');

      expect(collected[0].type).toBe('STREAMED_METADATA');
      expect(collected[collected.length - 1].lastChunk).toBe(true);
    });
  });
});
