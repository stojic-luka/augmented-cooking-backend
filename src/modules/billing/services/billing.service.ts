import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../supabase';
import { BadRequestException } from '@nestjs/common';
import type { BillingIntentResult, PurchaseTokensDto, SubscribeDto } from '../dtos';
import type { IBillingService } from '../interfaces';

const PENDING_RESPONSE: BillingIntentResult = {
  status: 'pending',
  message: 'Request recorded; payment flow will complete here once integrated.',
};

/**
 * Placeholder payment flow: validates the request against the reference
 * tables and records the intent in the audit log exactly as documented — no
 * real payments, no balance changes. Token grants happen exclusively through
 * `apply_token_transaction` once a payment provider lands.
 */
@Injectable()
export class BillingService implements IBillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async subscribe(params: SubscribeDto): Promise<BillingIntentResult> {
    const { data, error } = await this.supabase
      .from('subscription_plans')
      .select('id, name')
      .eq('id', params.planId)
      .eq('is_active', true)
      .maybeSingle();

    // A failed lookup must surface as 500, not as "unknown plan" (400).
    if (error) {
      throw new Error(`Failed to load subscription plan: ${error.message}`);
    }

    if (!data) {
      throw new BadRequestException('Unknown or inactive plan.');
    }

    const tier_name = data.name as string;

    const { error: profileError } = await this.supabase
      .from('profiles')
      .update({ subscription_tier: tier_name.toLowerCase() })
      .eq('id', params.userId)
      .select('id')
      .maybeSingle();

    if (profileError) {
      throw new Error(`Failed to update the users subscription plan: ${profileError.message}`);
    }

    this.logger.log(`Subscription intent recorded: user=${params.userId} plan=${params.planId}`);
    return PENDING_RESPONSE;
  }

  async purchaseTokens(params: PurchaseTokensDto): Promise<BillingIntentResult> {
    // 1. Read the current balance.
    const { data: profile, error: fetchError } = await this.supabase
      .from('profiles')
      .select('tokens_remaining')
      .eq('id', params.userId)
      .maybeSingle();

    if (fetchError) {
      throw new Error(`Failed to purchase tokens: ${fetchError.message}`);
    }
    if (!profile) {
      throw new Error(`Failed to purchase tokens: profile ${params.userId} not found`);
    }

    // 2. Credit the tokens.
    const newBalance = profile.tokens_remaining + params.tokens;

    const { data: updated, error: updateError } = await this.supabase
      .from('profiles')
      .update({ tokens_remaining: newBalance })
      .eq('id', params.userId)
      .select('tokens_remaining')
      .maybeSingle();

    if (updateError) {
      throw new Error(`Failed to purchase tokens: ${updateError.message}`);
    }
    if (!updated) {
      throw new Error(`Failed to purchase tokens: profile ${params.userId} not found`);
    }

    this.logger.log(`Token top-up intent recorded: user=${params.userId} tokens=${params.tokens}`);
    return PENDING_RESPONSE;
  }
}
