import { GenerateContentParameters, GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AiUnavailableException } from '../../../common/exceptions/index';
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
export class GeminiStrategy extends AiProviderStrategy {
  readonly providerId = 'gemini';
  private readonly sdk: GoogleGenAI;
  private readonly defaultModel = 'gemini-2.5-flash';

  constructor(config: ConfigService) {
    super();
    this.sdk = new GoogleGenAI({
      apiKey: config.get<string>('GEMINI_API_KEY'),
    });
  }

  private toUsage(usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  }): AiTokenUsage {
    const promptTokens = usage?.promptTokenCount ?? 0;
    const completionTokens = usage?.candidatesTokenCount ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: usage?.totalTokenCount ?? promptTokens + completionTokens,
    };
  }

  private mapMessages(messages: ChatMessage[]) {
    const systemInstructions: string[] = [];
    const contents: any[] = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemInstructions.push(m.content);
      } else {
        contents.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        });
      }
    }

    return {
      contents,
      systemInstruction: systemInstructions.join('\n') || undefined,
    };
  }

  private buildParameters(
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): GenerateContentParameters {
    const { contents, systemInstruction } = this.mapMessages(messages);

    return {
      model: options.model || this.defaultModel,
      contents,
      config: {
        systemInstruction,
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
        abortSignal: options.signal,
        ...(options.responseSchema && {
          responseMimeType: 'application/json',
          responseJsonSchema: options.responseSchema.schema,
        }),
      },
    };
  }

  async generateChat(
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): Promise<AiCompleteResponse> {
    try {
      const parameters = this.buildParameters(messages, options);
      const response = await this.sdk.models.generateContent(parameters);

      return {
        requestId: options.requestId,
        type: 'COMPLETE',
        metadata: {
          userId: options.userId,
          model: response.modelVersion || parameters.model,
          role: 'assistant',
          timestamp: Date.now(),
          userMessageId: randomUUID(),
          aiMessageId: randomUUID(),
        },
        content: {
          text: response.text || '',
          images: [],
        },
        usage: this.toUsage(response.usageMetadata),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiUnavailableException(`Gemini Generation Failed: ${message}`);
    }
  }

  async *generateStream(
    messages: ChatMessage[],
    options: AiRequestOptions,
  ): AsyncGenerator<AiStreamChunk, void, unknown> {
    const parameters = this.buildParameters(messages, options);
    let sequence = 0;

    try {
      // 1. Initial Metadata Payload
      yield {
        requestId: options.requestId,
        type: 'STREAMED_METADATA',
        sequence: sequence++,
        lastChunk: false,
        content: {
          userId: options.userId,
          model: parameters.model,
          role: 'assistant',
          timestamp: Date.now(),
          userMessageId: randomUUID(),
          aiMessageId: randomUUID(),
        },
      };

      // 2. Fetch and Stream Text Tokens
      const responseStream = await this.sdk.models.generateContentStream(parameters);

      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield {
            requestId: options.requestId,
            type: 'STREAMED_TEXT',
            sequence: sequence++,
            lastChunk: false,
            content: chunk.text,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AiUnavailableException(`Gemini Streaming Failed: ${message}`);
    } finally {
      // 3. Final Closing Token
      // Executed on successful stream completion or break, ensuring state closure.
      yield {
        requestId: options.requestId,
        type: 'STREAMED_TEXT',
        sequence: sequence++,
        lastChunk: true,
        content: '',
      };
    }
  }
}
