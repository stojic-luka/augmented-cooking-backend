import { SupabaseClient } from '@supabase/supabase-js';
import type { Mock } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { QuotaRepository } from './quota.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';

/** Builder supporting the three shapes the repository uses. */
function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const tail = {
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.delete = vi.fn(() => c);
  Object.assign(c, tail);
  // awaited directly after the builder calls
  // oxlint-disable-next-line unicorn/no-thenable -- the repository awaits query builders directly
  (c as { then: unknown }).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return c;
}

describe('QuotaRepository', () => {
  let supabase: ReturnType<typeof mockDeep<SupabaseClient>>;
  let repository: QuotaRepository;

  beforeEach(() => {
    supabase = mockDeep<SupabaseClient>();
    repository = new QuotaRepository(supabase);
  });

  describe('getProfile', () => {
    it('reads subscription_tier and tokens_remaining for the user', async () => {
      const profiles = chain({
        data: { subscription_tier: 'premium', tokens_remaining: 500 },
        error: null,
      });
      (supabase.from as Mock).mockReturnValue(profiles);

      const profile = await repository.getProfile(USER_ID);

      expect(supabase.from).toHaveBeenCalledWith('profiles');
      expect(profiles.select).toHaveBeenCalledWith('subscription_tier, tokens_remaining');
      expect(profiles.eq).toHaveBeenCalledWith('id', USER_ID);
      expect(profile).toEqual({ subscription_tier: 'premium', tokens_remaining: 500 });
    });

    it('returns null when the profile is missing and throws on query errors', async () => {
      (supabase.from as Mock).mockReturnValue(chain({ data: null, error: null }));
      expect(await repository.getProfile(USER_ID)).toBeNull();

      (supabase.from as Mock).mockReturnValue(
        chain({ data: null, error: { message: 'permission denied' } }),
      );
      await expect(repository.getProfile(USER_ID)).rejects.toThrow(
        'Failed to load profile: permission denied',
      );
    });
  });

  describe('getActivePlan', () => {
    it('reads the active subscription with its plan embed', async () => {
      const subscriptions = chain({
        data: { plan: [{ ai_actions_per_day: 30, tokens_per_month: 1000 }] },
        error: null,
      });
      (supabase.from as Mock).mockReturnValue(subscriptions);

      const plan = await repository.getActivePlan(USER_ID);

      expect(supabase.from).toHaveBeenCalledWith('user_subscriptions');
      expect(subscriptions.select).toHaveBeenCalledWith(
        'plan:subscription_plans(ai_actions_per_day, tokens_per_month)',
      );
      expect(subscriptions.eq).toHaveBeenCalledWith('user_id', USER_ID);
      expect(subscriptions.eq).toHaveBeenCalledWith('status', 'active');
      expect(plan).toEqual({ ai_actions_per_day: 30, tokens_per_month: 1000 });
    });

    it('unwraps the plan object when the embed comes back as an object, not an array', async () => {
      (supabase.from as Mock).mockReturnValue(
        chain({ data: { plan: { ai_actions_per_day: 5, tokens_per_month: null } }, error: null }),
      );

      expect(await repository.getActivePlan(USER_ID)).toEqual({
        ai_actions_per_day: 5,
        tokens_per_month: null,
      });
    });

    it('returns null without an active subscription', async () => {
      (supabase.from as Mock).mockReturnValue(chain({ data: null, error: null }));

      expect(await repository.getActivePlan(USER_ID)).toBeNull();
    });
  });

  describe('reserveAiUsage', () => {
    it('calls the reserve RPC with the daily cap and returns the usage id', async () => {
      (supabase.rpc as Mock).mockResolvedValue({
        data: 'usage-abc',
        error: null,
      });

      const usageId = await repository.reserveAiUsage(USER_ID, 'generate_recipe', 30);

      expect(supabase.rpc).toHaveBeenCalledWith('reserve_ai_usage', {
        p_user_id: USER_ID,
        p_action: 'generate_recipe',
        p_daily_cap: 30,
      });
      expect(usageId).toBe('usage-abc');
    });

    it('throws the RPC error untouched so callers can match on code/message', async () => {
      const rpcError = { code: 'P0001', message: 'DAILY_CAP_REACHED', details: null, hint: null };
      (supabase.rpc as Mock).mockResolvedValue({ data: null, error: rpcError });

      await expect(repository.reserveAiUsage(USER_ID, 'chat', 30)).rejects.toBe(rpcError);
    });
  });

  describe('completeAiUsage', () => {
    it('calls the completion RPC with token accounting and returns the new balance', async () => {
      (supabase.rpc as Mock).mockResolvedValue({ data: 970, error: null });

      const remaining = await repository.completeAiUsage({
        usageId: 'usage-abc',
        modelId: USER_ID,
        promptTokens: 10,
        completionTokens: 20,
        tokenCost: 30,
      });

      expect(supabase.rpc).toHaveBeenCalledWith('complete_ai_usage', {
        p_usage_id: 'usage-abc',
        p_model_id: USER_ID,
        p_prompt_tokens: 10,
        p_completion_tokens: 20,
        p_token_cost: 30,
      });
      expect(remaining).toBe(970);
    });

    it('throws the RPC error untouched', async () => {
      const rpcError = { code: 'P0001', message: 'INSUFFICIENT_TOKENS', details: null, hint: null };
      (supabase.rpc as Mock).mockResolvedValue({ data: null, error: rpcError });

      await expect(
        repository.completeAiUsage({
          usageId: 'usage-abc',
          modelId: USER_ID,
          promptTokens: 1,
          completionTokens: 1,
          tokenCost: 2,
        }),
      ).rejects.toBe(rpcError);
    });
  });

  describe('deleteReservation', () => {
    it('deletes the reservation row by id', async () => {
      const aiUsageLog = chain({ error: null });
      (supabase.from as Mock).mockReturnValue(aiUsageLog);

      await repository.deleteReservation('usage-abc');

      expect(supabase.from).toHaveBeenCalledWith('ai_usage_log');
      expect(aiUsageLog.delete).toHaveBeenCalled();
      expect(aiUsageLog.eq).toHaveBeenCalledWith('id', 'usage-abc');
    });

    it('throws a descriptive error when the delete fails', async () => {
      (supabase.from as Mock).mockReturnValue(chain({ error: { message: 'row gone' } }));

      await expect(repository.deleteReservation('usage-abc')).rejects.toThrow(
        'Failed to release AI usage reservation: row gone',
      );
    });
  });
});
