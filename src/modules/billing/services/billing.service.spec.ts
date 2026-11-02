import { BadRequestException } from '@nestjs/common';
import type { Mock } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { mockDeep } from 'vitest-mock-extended';
import { BillingService } from './billing.service';

const PREMIUM_PLAN_ID = '22222222-2222-4222-8222-222222222222';

describe('BillingService', () => {
  let supabase: ReturnType<typeof mockDeep<SupabaseClient>>;
  let service: BillingService;

  beforeEach(() => {
    supabase = mockDeep<SupabaseClient>();
    service = new BillingService(supabase);
  });

  function wirePlans(result: { data: unknown }) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(result),
    };
    (supabase.from as Mock).mockImplementation((table: string) => {
      if (table !== 'subscription_plans') {
        throw new Error(`unexpected table: ${table}`);
      }
      return chain;
    });
    return chain;
  }

  describe('subscribe', () => {
    it('records the intent when the plan exists and is active', async () => {
      const chain = wirePlans({ data: { id: PREMIUM_PLAN_ID } });

      const result = await service.subscribe({ userId: 'u1', planId: PREMIUM_PLAN_ID });

      expect(supabase.from).toHaveBeenCalledWith('subscription_plans');
      expect(chain.eq).toHaveBeenCalledWith('id', PREMIUM_PLAN_ID);
      expect(chain.eq).toHaveBeenCalledWith('is_active', true);
      expect(result).toEqual({
        status: 'pending',
        message: 'Request recorded; payment flow will complete here once integrated.',
      });
    });

    it('rejects unknown or inactive plans with 400', async () => {
      wirePlans({ data: null });

      await expect(service.subscribe({ userId: 'u1', planId: PREMIUM_PLAN_ID })).rejects.toThrow(
        new BadRequestException('Unknown or inactive plan.'),
      );
    });

    it('surfaces a failed plan lookup as an error instead of 400 unknown plan', async () => {
      const dbFailure = { data: null, error: { message: 'connection refused' } };
      wirePlans(dbFailure);

      await expect(service.subscribe({ userId: 'u1', planId: PREMIUM_PLAN_ID })).rejects.toThrow(
        'Failed to load subscription plan: connection refused',
      );
    });
  });

  describe('purchaseTokens', () => {
    it('records the intent without touching any table (grant happens via payment provider RPC)', async () => {
      const result = await service.purchaseTokens({ userId: 'u1', tokens: 10_000 });

      expect(supabase.from).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'pending',
        message: 'Request recorded; payment flow will complete here once integrated.',
      });
    });
  });
});
