import { Inject, Injectable } from '@nestjs/common';
import { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase';
import { AiActionType } from '../../ai';

interface RpcResult<T> {
  data: T;
  error: PostgrestError | null;
}

/**
 * Data access for the quota lifecycle. All balance mutations happen inside
 * the SECURITY DEFINER RPCs defined in the database migration — never by
 * count-then-act application logic.
 */
@Injectable()
export class QuotaRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async getProfile(userId: string): Promise<{
    subscription_tier: string;
    tokens_remaining: number;
  } | null> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select('subscription_tier, tokens_remaining')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load profile: ${error.message}`);
    }
    const row: unknown = data;
    const profile = row as { subscription_tier: string; tokens_remaining: number } | null;
    return profile ?? null;
  }

  async getActivePlan(userId: string): Promise<{
    ai_actions_per_day: number | null;
    tokens_per_month: number | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('plan:subscription_plans(ai_actions_per_day, tokens_per_month)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load active subscription: ${error.message}`);
    }

    // supabase-js types one-to-many embeds as arrays; with .maybeSingle()
    // and a single active row the value is the plan object at runtime.
    const plan = (
      data as {
        plan?:
          | Array<{ ai_actions_per_day: number | null; tokens_per_month: number | null }>
          | { ai_actions_per_day: number | null; tokens_per_month: number | null }
          | null;
      } | null
    )?.plan;
    const record = Array.isArray(plan) ? plan[0] : plan;
    return record ?? null;
  }

  /** PHASE 1 — atomic reservation. Throws with the RPC error code on cap hit. */
  async reserveAiUsage(
    userId: string,
    action: AiActionType,
    dailyCap: number | null,
  ): Promise<string> {
    const { data, error } = (await this.supabase.rpc('reserve_ai_usage', {
      p_user_id: userId,
      p_action: action,
      p_daily_cap: dailyCap,
    })) as RpcResult<string>;

    if (error) {
      throw error;
    }
    return data;
  }

  /** PHASE 2 — idempotent completion + token debit. */
  async completeAiUsage(params: {
    usageId: string;
    modelId: string;
    promptTokens: number;
    completionTokens: number;
    tokenCost: number;
  }): Promise<number> {
    const { data, error } = (await this.supabase.rpc('complete_ai_usage', {
      p_usage_id: params.usageId,
      p_model_id: params.modelId,
      p_prompt_tokens: params.promptTokens,
      p_completion_tokens: params.completionTokens,
      p_token_cost: params.tokenCost,
    })) as RpcResult<number>;

    if (error) {
      throw error;
    }
    return data;
  }

  /** Rollback of an abandoned reservation after a provider failure. */
  async deleteReservation(usageId: string): Promise<void> {
    const { error } = await this.supabase.from('ai_usage_log').delete().eq('id', usageId);

    if (error) {
      throw new Error(`Failed to release AI usage reservation: ${error.message}`);
    }
  }
}
