import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiActionType, AiModelCatalogService } from '../../ai';
import { QuotaExceededException } from '../../../common/exceptions/index';
import { QuotaRepository } from '../repositories';
import type { IQuotaService, QuotaReservation } from '../interfaces';

const FREE_FALLBACK_DAILY_CAP = 30;

/**
 * Enforces the product quota rules using the database quota RPCs:
 *  - free tier: 30 AI actions per calendar day (UTC), economy models only;
 *  - premium: unlimited actions; /ai/chat additionally debits chat tokens.
 *
 * The free cap is read from the active subscription plan
 * (`subscription_plans.ai_actions_per_day`), falling back to the
 * documented default of 30.
 */
@Injectable()
export class QuotaService implements IQuotaService {
  constructor(
    private readonly repository: QuotaRepository,
    private readonly modelCatalog: AiModelCatalogService,
    config: ConfigService,
  ) {
    this.freeFallbackDailyCap =
      config.get<number>('Ai.FreeDailyActions') ?? FREE_FALLBACK_DAILY_CAP;
  }

  private readonly freeFallbackDailyCap: number;

  async reserve(params: {
    userId: string;
    action: AiActionType;
    modelId?: string;
  }): Promise<QuotaReservation> {
    const tier = await this.modelCatalog.getTier(params.userId);
    // Model resolution is read-only — it must happen BEFORE the reservation
    // exists, so a catalog failure can never leave an abandoned row behind
    // that burns the caller's daily cap. It is independent of the plan lookup,
    // so both reads run in parallel.
    const [resolved, dailyCap] = await Promise.all([
      this.modelCatalog.resolveModel(params.modelId, tier),
      tier === 'premium' ? Promise.resolve(null) : this.resolveFreeDailyCap(params.userId),
    ]);

    let usageId: string;
    try {
      usageId = await this.repository.reserveAiUsage(params.userId, params.action, dailyCap);
    } catch (error) {
      throw this.mapQuotaError(error);
    }

    return {
      usageId,
      route: {
        id: resolved.record.id,
        provider: resolved.provider,
        providerModel: resolved.providerModel,
      },
      tier,
      action: params.action,
    };
  }

  async complete(params: {
    reservation: QuotaReservation;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }): Promise<void> {
    const { reservation, promptTokens, completionTokens } = params;
    const tokenCost = this.computeTokenCost(reservation, promptTokens + completionTokens);

    try {
      await this.repository.completeAiUsage({
        usageId: reservation.usageId,
        modelId: reservation.route.id,
        promptTokens,
        completionTokens,
        tokenCost,
      });
    } catch (error) {
      if ((error as { message?: string })?.message?.includes('INSUFFICIENT_TOKENS')) {
        throw new QuotaExceededException(
          'Not enough chat tokens remaining. Purchase a top-up to continue.',
        );
      }
      throw error;
    }
  }

  async release(reservation: QuotaReservation): Promise<void> {
    await this.repository.deleteReservation(reservation.usageId);
  }

  private async resolveFreeDailyCap(userId: string): Promise<number> {
    const plan = await this.repository.getActivePlan(userId);
    return plan?.ai_actions_per_day ?? this.freeFallbackDailyCap;
  }

  /**
   * Chat is the only token-metered action: premium users spend from their
   * token balance on /ai/chat, so the cost equals the tokens actually used.
   * All other actions are token-free (cost 0), free tier included.
   */
  private computeTokenCost(reservation: QuotaReservation, tokensUsed: number): number {
    return reservation.tier === 'premium' && reservation.action === 'chat' ? tokensUsed : 0;
  }

  /**
   * Maps the quota RPCs' raise-exception signals to 429. Anything else is an
   * infrastructure failure and propagates untouched (→ 500) so outages are
   * never masked as quota exhaustion.
   */
  private mapQuotaError(error: unknown): unknown {
    const message = (error as { message?: string })?.message ?? '';

    if (message.includes('DAILY_CAP_REACHED')) {
      return new QuotaExceededException(
        'Daily AI action limit reached. Upgrade to premium for unlimited AI actions.',
      );
    }
    if (message.includes('INSUFFICIENT_TOKENS')) {
      return new QuotaExceededException(
        'Not enough chat tokens remaining. Purchase a top-up to continue.',
      );
    }
    return error;
  }
}
