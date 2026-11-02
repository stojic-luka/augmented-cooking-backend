import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import type { Response } from 'express';
import { GetAbortSignal, GetCurrentUser } from '@common/decorators/request';
import { SupabaseAuthGuard } from '@modules/auth';
import { getErrorMessage } from '@utils/index';
import { CHAT_SERVICE_TOKEN } from '../constants';
import { SendChatMessageBodyDto } from '../dtos';
import type { IChatService } from '../interfaces';

@UseGuards(SupabaseAuthGuard)
@Controller('ai')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    @Inject(CHAT_SERVICE_TOKEN)
    private readonly chatService: IChatService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Body() body: SendChatMessageBodyDto,
    @GetCurrentUser() user: AuthUser,
    @GetAbortSignal() signal: AbortSignal,
  ) {
    this.logger.debug(body);
    const { text, modelId, reply, tokensUsed } = await this.chatService.sendMessage({
      userId: user.id,
      signal,
      sessionId: body.sessionId,
      messages: body.messages,
      modelId: body.modelId,
    });

    // `text`/`modelId` are the contract fields; `reply`/`tokensUsed` stay for
    // the shipped clients, which ignore unknown fields.
    return { text, modelId, reply, tokensUsed };
  }

  /**
   * Streaming sibling of POST /ai/chat: the streaming mode is expressed only
   * by the route (POST — the payload is too large for GET/query strings; the
   * body is the same SendChatMessageBodyDto). Manual SSE over the raw
   * response — Nest's @Sse() registers a GET route, which the client cannot
   * use. Frames: `meta` → `delta`* → `done`, or a final `error` frame on a
   * mid-stream failure.
   */
  @Post('chat/stream')
  async streamChat(
    @Body() body: SendChatMessageBodyDto,
    @Res() res: Response,
    @GetCurrentUser() user: AuthUser,
    @GetAbortSignal() signal: AbortSignal,
  ): Promise<void> {
    this.logger.debug(body);
    // A disconnect surfaces as response close, and as request close through
    // the cancellation interceptor's signal; either cancels the generation.
    const abort = new AbortController();
    const cancel = (): void => abort.abort();
    signal.addEventListener('abort', cancel, { once: true });
    res.on('close', cancel);
    res.on('error', (error: Error) => {
      this.logger.debug(`Chat stream socket error: ${error.message}`);
    });

    const send = (payload: Record<string, unknown>): void => {
      if (res.destroyed || res.writableEnded) {
        return; // the client is gone; dropping a frame beats a write error
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      // Quota reservation and model resolution happen before any SSE framing:
      // a pre-stream failure (401/400/429/500) must stay a normal JSON error
      // response, so the handler only touches headers once setup succeeded.
      const { modelId, stream } = await this.chatService.streamChat({
        userId: user.id,
        signal: abort.signal,
        sessionId: body.sessionId,
        messages: body.messages,
        modelId: body.modelId,
      });

      res
        .status(200)
        .setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        .setHeader('Cache-Control', 'no-cache, no-transform')
        .setHeader('X-Accel-Buffering', 'no')
        .flushHeaders();

      send({ type: 'meta', modelId });

      let full = '';
      for await (const fragment of stream) {
        full += fragment;
        send({ type: 'delta', text: fragment });
      }

      send({ type: 'done', text: full, modelId });
    } catch (error) {
      if (!res.headersSent) {
        // Pre-stream failure: the global filter owns the documented flat
        // JSON error body.
        throw error;
      }
      if (abort.signal.aborted) {
        this.logger.debug(`Chat stream cancelled by the client: ${getErrorMessage(error)}`);
      } else {
        this.logger.error(`Chat stream failed mid-stream: ${getErrorMessage(error)}`);
      }
      send({ type: 'error', message: getErrorMessage(error) });
    } finally {
      if (res.headersSent) {
        res.end();
      }
    }
  }
}
