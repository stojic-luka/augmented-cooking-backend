import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_SERVICE_TOKEN } from '../../ai';
import type { AiProviderType, AiRequestOptions, ChatMessage, IAiService } from '../../ai';
import { QUOTA_SERVICE_TOKEN } from '../../quota';
import type { IQuotaService, QuotaReservation } from '../../quota';
import { getErrorMessage } from '../../../utils/index';
import { CHAT_SYSTEM_PROMPT } from '../prompts';
import type { SendChatMessageDto, SendChatMessageResult, StreamChatMessageResult } from '../dtos';
import type { IChatService } from '../interfaces';

/**
 * Cooking-assistant chat. The client owns history (it sends the recent turns
 * and persists the reply); the server enforces the quota rules — free tier
 * consumes a daily action, premium additionally debits chat tokens — and
 * never persists messages.
 */
@Injectable()
export class ChatService implements IChatService {
  private readonly maxHistoryTurns = 40;
  /**
   * Stream chunks carry no token usage, so premium chat is metered with a
   * best-effort ~4 chars/token estimate instead of billing zero.
   */
  private static readonly charsPerToken = 4;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(AI_SERVICE_TOKEN)
    private readonly aiService: IAiService,
    @Inject(QUOTA_SERVICE_TOKEN)
    private readonly quotaService: IQuotaService,
  ) {}

  async sendMessage(params: SendChatMessageDto): Promise<SendChatMessageResult> {
    const reservation = await this.quotaService.reserve({
      userId: params.userId,
      action: 'chat',
      modelId: params.modelId,
    });

    console.log(reservation);

    const messages: ChatMessage[] = this.buildMessages(params);

    try {
      const response = await this.aiService.generateChat(
        this.resolveProvider(reservation),
        messages,
        this.buildRequestOptions(params, reservation),
      );

      await this.quotaService.complete({
        reservation,
        model: response.metadata.model,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
      });

      const reply = response.content.text;
      return {
        text: reply,
        modelId: reservation.route.id,
        reply,
        tokensUsed: response.usage.totalTokens,
      };
    } catch (error) {
      await this.releaseQuietly(reservation);
      throw error;
    }
  }

  async streamChat(params: SendChatMessageDto): Promise<StreamChatMessageResult> {
    const reservation = await this.quotaService.reserve({
      userId: params.userId,
      action: 'chat',
      modelId: params.modelId,
    });

    return {
      modelId: reservation.route.id,
      stream: this.streamAssistantReply(params, reservation),
    };
  }

  /**
   * Streams the assistant answer as plain-text fragments. Metadata and image
   * chunks are dropped; the reservation is completed after the last fragment
   * and released on any failure, client aborts included.
   */
  private async *streamAssistantReply(
    params: SendChatMessageDto,
    reservation: QuotaReservation,
  ): AsyncGenerator<string, void, unknown> {
    const messages: ChatMessage[] = this.buildMessages(params);
    const options = this.buildRequestOptions(params, reservation);
    let model = reservation.route.providerModel ?? 'unknown';
    let fullText = '';

    try {
      for await (const chunk of this.aiService.generateStream(
        this.resolveProvider(reservation),
        messages,
        options,
      )) {
        if (chunk.type === 'STREAMED_METADATA') {
          model = chunk.content.model || model;
          continue;
        }
        if (chunk.type !== 'STREAMED_TEXT') {
          continue; // images are not part of the chat answer
        }
        if (!chunk.content) {
          continue; // the strategies close with an empty final chunk
        }
        fullText += chunk.content;
        yield chunk.content;
      }

      await this.quotaService.complete({
        reservation,
        model,
        promptTokens: this.estimateTokens(messages.map((m) => m.content).join('\n')),
        completionTokens: this.estimateTokens(fullText),
      });
    } catch (error) {
      await this.releaseQuietly(reservation);
      throw error;
    }
  }

  private buildMessages(params: SendChatMessageDto): ChatMessage[] {
    return [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...params.messages.slice(-this.maxHistoryTurns),
    ];
  }

  private resolveProvider(reservation: QuotaReservation): AiProviderType {
    return reservation.route.provider === 'default'
      ? (this.config.get<string>('Ai.DefaultProvider') ?? 'openai')
      : reservation.route.provider;
  }

  private buildRequestOptions(
    params: SendChatMessageDto,
    reservation: QuotaReservation,
  ): AiRequestOptions {
    return {
      userId: params.userId,
      requestId: `chat-${params.sessionId}-${Date.now()}`,
      provider: reservation.route.provider === 'default' ? undefined : reservation.route.provider,
      model: reservation.route.providerModel,
      temperature: 0.7,
      signal: params.signal,
    };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / ChatService.charsPerToken);
  }

  /** Best-effort release: a failed release must never mask the original error. */
  private async releaseQuietly(reservation: QuotaReservation): Promise<void> {
    try {
      await this.quotaService.release(reservation);
    } catch (releaseError) {
      this.logger.warn(
        `Failed to release chat reservation ${reservation.usageId}: ${getErrorMessage(releaseError)}`,
      );
    }
  }
}
