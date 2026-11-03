import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_SERVICE_TOKEN } from '../constants';
import type { IAiService } from '../interfaces';
import type { AiRequestOptions, ChatMessage } from '../types';
import { AiResponseInvalidException, AiUnavailableException } from '../../../common/exceptions/index';

interface ValidatedGeneration<T> {
  data: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
}

/**
 * Runs a prompt against the configured provider and guarantees that the
 * output parses against a zod schema: on malformed JSON or validation
 * failure, one repair round-trip is attempted before giving up. Callers
 * never receive an unvalidated value.
 */
@Injectable()
export class AiJsonService {
  constructor(
    @Inject(AI_SERVICE_TOKEN)
    private readonly aiService: IAiService,
    private readonly config: ConfigService,
  ) {}

  async generateValidated<T>(params: {
    options: AiRequestOptions;
    systemPrompt: string;
    userPrompt: string;
    jsonSchema: Record<string, unknown>;
    parse: (value: unknown) => T;
  }): Promise<ValidatedGeneration<T>> {
    const { options, systemPrompt, userPrompt, jsonSchema, parse } = params;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const schemaTitle = typeof jsonSchema.title === 'string' ? jsonSchema.title : 'RESPONSE';
    let first: Awaited<ReturnType<IAiService['generateChat']>>;
    try {
      first = await this.aiService.generateChat(this.provider(options), messages, {
        ...options,
        responseSchema: { title: schemaTitle, schema: jsonSchema },
      });
    } catch (error) {
      throw new AiUnavailableException((error as Error)?.message);
    }

    const firstParsed = this.tryParse(first.content.text, parse);
    if (firstParsed.ok) {
      return { data: firstParsed.value, usage: first.usage, model: first.metadata.model };
    }

    const repair = await this.repair(schemaTitle, options, first.content.text, firstParsed.error);
    const repaired = this.tryParse(repair.content.text, parse);
    if (repaired.ok) {
      return {
        data: repaired.value,
        usage: this.addUsage(first.usage, repair.usage),
        model: repair.metadata.model,
      };
    }

    throw new AiResponseInvalidException();
  }

  private async repair(
    schemaTitle: string,
    options: AiRequestOptions,
    invalidOutput: string,
    problem: string,
  ): Promise<Awaited<ReturnType<IAiService['generateChat']>>> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You fix malformed AI outputs. You will be given an invalid response and the validation problem. Return ONLY the corrected raw JSON object conforming to the "${schemaTitle}" schema. No markdown, no commentary.`,
      },
      {
        role: 'user',
        content: `Validation problem: ${problem}\n\nInvalid response:\n${invalidOutput}`,
      },
    ];

    return this.aiService.generateChat(this.provider(options), messages, options);
  }

  private tryParse<T>(
    text: string,
    parse: (value: unknown) => T,
  ): { ok: true; value: T } | { ok: false; error: string } {
    let value: unknown;
    try {
      value = JSON.parse(this.stripJsonFences(text));
    } catch {
      return { ok: false, error: 'Output is not valid JSON.' };
    }

    try {
      return { ok: true, value: parse(value) };
    } catch (error) {
      return { ok: false, error: (error as Error)?.message || 'Schema validation failed.' };
    }
  }

  private stripJsonFences(text: string): string {
    const trimmed = text.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    return fenced ? fenced[1].trim() : trimmed;
  }

  private provider(options: AiRequestOptions): string {
    return options.provider || (this.config.get<string>('Ai.DefaultProvider') ?? 'gemini');
  }

  private addUsage(
    a: { promptTokens: number; completionTokens: number; totalTokens: number },
    b: { promptTokens: number; completionTokens: number; totalTokens: number },
  ): { promptTokens: number; completionTokens: number; totalTokens: number } {
    return {
      promptTokens: a.promptTokens + b.promptTokens,
      completionTokens: a.completionTokens + b.completionTokens,
      totalTokens: a.totalTokens + b.totalTokens,
    };
  }
}
