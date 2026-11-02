import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '@modules/supabase';
import {
  AiModelDto,
  AiModelRecord,
  AiModelsResponse,
  SubscriptionTier,
  aiModelRecordSchema,
  subscriptionTierSchema,
} from '../ai.models';

/**
 * Model catalog backed by the `ai_models` reference table. Enforces the
 * subscription rule: free tier sees economy models only; premium sees both.
 *
 * The table is ops-managed reference data, so it is cached in-process for a
 * short TTL: one load serves every AI request / models listing for 30s
 * instead of one Supabase round-trip per call. Failures are never cached.
 */
@Injectable()
export class AiModelCatalogService {
  private static readonly CACHE_TTL_MS = 30_000;

  private cache: { models: AiModelRecord[]; expiresAt: number } | null = null;

  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Reads `profiles.subscription_tier`; unknown profiles are treated as free.
   * A failed lookup throws (→ 500) — an outage must not silently downgrade
   * premium users to the free tier.
   */
  async getTier(userId: string): Promise<SubscriptionTier> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load subscription tier: ${error.message}`);
    }

    const parsed = subscriptionTierSchema.safeParse(data?.subscription_tier);
    return parsed.success ? parsed.data : 'free';
  }

  async listForTier(tier: SubscriptionTier): Promise<AiModelsResponse> {
    const models = await this.listAll();
    const visible = models
      .filter((model) => model.is_enabled)
      .filter((model) => (tier === 'premium' ? true : model.tier === 'economy'))
      .map<AiModelDto>(({ id, name, tier: modelTier, is_enabled, min_tier }) => ({
        id,
        name,
        tier: modelTier,
        is_enabled,
        min_tier,
      }));

    return { models: visible };
  }

  /**
   * Resolves the model to call. The modelId is client-chosen but never
   * trusted: it must exist, be enabled, and be allowed for the caller's tier.
   * Returns the row plus the concrete provider/model ids for the strategy.
   */
  async resolveModel(
    modelId: string | undefined,
    tier: SubscriptionTier,
  ): Promise<{ record: AiModelRecord; provider: string; providerModel?: string }> {
    const models = await this.listAll();
    const fallback =
      models.find((model) => model.is_enabled && model.tier === 'economy') ?? models[0];

    let record: AiModelRecord | undefined;
    if (modelId) {
      record = models.find((model) => model.id === modelId);
      if (!record || !record.is_enabled) {
        record = undefined;
      } else if (tier === 'free' && record.tier !== 'economy') {
        record = undefined;
      }
    } else {
      record = fallback;
    }

    if (!record) {
      record = fallback;
    }
    if (!record) {
      throw new Error('No AI models are configured (ai_models table is empty).');
    }

    return {
      record,
      provider: record.provider ?? 'default',
      providerModel: record.provider_model ?? undefined,
    };
  }

  private async listAll(): Promise<AiModelRecord[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.models;
    }

    const { data, error } = await this.supabase.from('ai_models').select('*');

    if (error) {
      throw new Error(`Failed to load AI models: ${error.message}`);
    }

    const parsed: AiModelRecord[] = [];
    for (const row of data ?? []) {
      const result = aiModelRecordSchema.safeParse(row);
      if (result.success) {
        parsed.push(result.data);
      }
    }

    // Empty results stay uncached: a transiently empty table (e.g. replication
    // lag) must not pin "no models configured" for a full TTL window.
    if (parsed.length > 0) {
      this.cache = { models: parsed, expiresAt: Date.now() + AiModelCatalogService.CACHE_TTL_MS };
    }
    return parsed;
  }
}
