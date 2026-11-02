import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AiUnavailableException } from '@exceptions/index';
import { ConfigService } from '@nestjs/config';
import { AiProviderStrategy } from '../contracts';
import {
  ChatMessage,
  AiRequestOptions,
  AiCompleteResponse,
  AiStreamChunk,
  AiTokenUsage,
} from '../types';

@Injectable()
export class OllamaStrategy extends AiProviderStrategy {
  readonly providerId = 'ollama';
  private readonly sdk: OpenAI;
  private readonly baseUrl: string | undefined;
  private readonly defaultModel = 'llama3';

  constructor(config: ConfigService) {
    super();
    // A missing base URL must not silently fall back to the OpenAI cloud
    // endpoint (the SDK default) — calls fail at request time instead.
    this.baseUrl = config.get<string>('OLLAMA_BASE_URL');
    this.sdk = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: config.get<string>('OLLAMA_API_KEY') ?? 'not-configured',
    });
  }

  private assertConfigured(): void {
    if (!this.baseUrl) {
      throw new AiUnavailableException(
        'OLLAMA_BASE_URL is not configured; cannot reach the local Ollama endpoint.',
      );
    }
  }

  private buildParameters(
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): OpenAI.ChatCompletionCreateParams {
    const parameters: OpenAI.ChatCompletionCreateParams = {
      model: options.model || this.defaultModel,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: options.temperature,
      max_completion_tokens: options.maxTokens,
    };

    if (options.responseSchema) {
      parameters.response_format = {
        type: 'json_schema',
        json_schema: {
          name: options.responseSchema.title,
          strict: true,
          schema: options.responseSchema.schema,
        },
      };
    }

    return parameters;
  }

  private toUsage(usage?: OpenAI.CompletionUsage): AiTokenUsage {
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    };
  }

  async generateChat(
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): Promise<AiCompleteResponse> {
    this.assertConfigured();
    const { userId, requestId, signal } = options;
    const parameters = this.buildParameters(messages, options);

    try {
      const response = await this.sdk.chat.completions.create(
        { ...parameters, stream: false },
        {
          signal,
        },
      );

      return {
        requestId,
        type: 'COMPLETE',
        metadata: {
          userId,
          model: response.model,
          role: 'assistant',
          timestamp: Date.now(),
          userMessageId: randomUUID(),
          aiMessageId: randomUUID(),
        },
        content: {
          text: response.choices[0]?.message?.content || '',
          images: [],
        },
        usage: this.toUsage(response.usage),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiUnavailableException(`Local OpenAI Generation Failed: ${message}`);
    }
  }

  async *generateStream(
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): AsyncGenerator<AiStreamChunk, void, unknown> {
    this.assertConfigured();
    const { userId, requestId, signal } = options;
    const model = options.model || this.defaultModel;
    let sequence = 0;

    yield {
      requestId,
      type: 'STREAMED_METADATA',
      sequence: sequence++,
      lastChunk: false,
      content: {
        userId,
        model,
        role: 'assistant',
        timestamp: Date.now(),
        userMessageId: randomUUID(),
        aiMessageId: randomUUID(),
      },
    };

    const parameters = this.buildParameters(messages, options);

    try {
      const stream = await this.sdk.chat.completions.create(
        { ...parameters, stream: true },
        {
          signal,
        },
      );

      for await (const chunk of stream) {
        const textDelta = chunk.choices[0]?.delta?.content;
        if (textDelta) {
          yield {
            requestId,
            type: 'STREAMED_TEXT',
            sequence: sequence++,
            lastChunk: false,
            content: textDelta,
          };
        }
      }

      yield {
        requestId,
        type: 'STREAMED_TEXT',
        sequence: sequence++,
        lastChunk: true,
        content: '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiUnavailableException(`Local OpenAI Streaming Failed: ${message}`);
    }
  }
}
