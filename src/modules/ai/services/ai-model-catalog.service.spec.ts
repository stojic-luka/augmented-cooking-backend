import type { Mock } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { mockDeep } from 'vitest-mock-extended';
import { AiModelCatalogService } from './ai-model-catalog.service';

const ECONOMY_ID = '11111111-1111-4111-8111-111111111111';
const ADVANCED_ID = '22222222-2222-4222-8222-222222222222';
const DISABLED_ID = '33333333-3333-4333-8333-333333333333';

function modelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ECONOMY_ID,
    name: 'Flash',
    tier: 'economy',
    is_enabled: true,
    min_tier: 'free',
    provider: 'gemini',
    provider_model: 'gemini-2.5-flash',
    ...overrides,
  };
}

/** `select(...).eq(...).maybeSingle()` chain resolving to a fixed result. */
function singleRowChain(data: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return chain;
}

/** Builder whose awaited `.select('*')` result resolves to `result`. */
function awaitedChain(result: { data: unknown; error: unknown }) {
  const thenable = {
    // oxlint-disable-next-line unicorn/no-thenable -- the catalog awaits `.select('*')` directly
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { select: vi.fn(() => thenable) };
}

describe('AiModelCatalogService', () => {
  let supabase: ReturnType<typeof mockDeep<SupabaseClient>>;
  let service: AiModelCatalogService;

  const MODELS = [
    modelRow(),
    modelRow({
      id: ADVANCED_ID,
      name: 'Pro',
      tier: 'advanced',
      min_tier: 'premium',
      provider_model: 'gemini-2.5-pro',
    }),
    modelRow({ id: DISABLED_ID, name: 'Retired', is_enabled: false }),
  ];

  beforeEach(() => {
    supabase = mockDeep<SupabaseClient>();
    service = new AiModelCatalogService(supabase);
    (supabase.from as Mock).mockImplementation((table: string) => {
      throw new Error(`unexpected table in test: ${table}`);
    });
  });

  function wire(chains: Record<string, unknown>) {
    (supabase.from as Mock).mockImplementation((table: string) => {
      const chain = chains[table];
      if (!chain) {
        throw new Error(`unexpected table in test: ${table}`);
      }
      return chain;
    });
  }

  describe('getTier', () => {
    it('returns the stored tier for a known profile', async () => {
      wire({ profiles: singleRowChain({ subscription_tier: 'premium' }) });

      const tier = await service.getTier('user-1');

      expect(tier).toBe('premium');
      expect(supabase.from).toHaveBeenCalledWith('profiles');
    });

    it('treats missing profiles and unknown tier values as free', async () => {
      wire({ profiles: singleRowChain(null) });
      expect(await service.getTier('user-1')).toBe('free');

      wire({ profiles: singleRowChain({ subscription_tier: 'enterprise' }) });
      expect(await service.getTier('user-1')).toBe('free');
    });

    it('throws on a failed profile lookup instead of silently treating the user as free', async () => {
      const failing = {
        select: vi.fn(() => failing),
        eq: vi.fn(() => failing),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection refused' } }),
      };
      wire({ profiles: failing });

      await expect(service.getTier('user-1')).rejects.toThrow(
        'Failed to load subscription tier: connection refused',
      );
    });
  });

  describe('listForTier', () => {
    it('shows only enabled economy models to the free tier, without provider columns', async () => {
      wire({ ai_models: awaitedChain({ data: MODELS, error: null }) });

      const response = await service.listForTier('free');

      expect(response.models).toEqual([
        { id: ECONOMY_ID, name: 'Flash', tier: 'economy', is_enabled: true, min_tier: 'free' },
      ]);
    });

    it('shows every enabled model to the premium tier', async () => {
      wire({ ai_models: awaitedChain({ data: MODELS, error: null }) });

      const response = await service.listForTier('premium');

      expect(response.models.map((m) => m.id)).toEqual([ECONOMY_ID, ADVANCED_ID]);
    });

    it('drops rows that fail schema validation instead of failing the request', async () => {
      wire({
        ai_models: awaitedChain({ data: [modelRow(), { id: 'garbage' }, null], error: null }),
      });

      const response = await service.listForTier('premium');

      expect(response.models).toHaveLength(1);
    });

    it('serves repeated catalog reads from the 30s cache (one Supabase round-trip)', async () => {
      vi.useFakeTimers();
      try {
        const chain = awaitedChain({ data: MODELS, error: null });
        wire({ ai_models: chain });

        await service.listForTier('free');
        await service.listForTier('premium');
        await service.resolveModel(ECONOMY_ID, 'free');

        expect(chain.select).toHaveBeenCalledTimes(1);

        // After the TTL the catalog is re-read and refreshed data is served.
        vi.setSystemTime(Date.now() + 31_000);
        const refreshed = awaitedChain({
          data: [modelRow({ name: 'Flash v2' })],
          error: null,
        });
        wire({ ai_models: refreshed });

        const afterExpiry = await service.listForTier('free');

        expect(refreshed.select).toHaveBeenCalledTimes(1);
        expect(afterExpiry.models[0].name).toBe('Flash v2');
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not cache a failed catalog load or a transiently empty table', async () => {
      wire({ ai_models: awaitedChain({ data: null, error: { message: 'db down' } }) });
      await expect(service.listForTier('free')).rejects.toThrow('Failed to load AI models');

      wire({ ai_models: awaitedChain({ data: [], error: null }) });
      await expect(service.resolveModel(ECONOMY_ID, 'free')).rejects.toThrow(
        'No AI models are configured',
      );

      // Neither failure nor empty result was cached — the next read hits
      // Supabase again and succeeds.
      const chain = awaitedChain({ data: MODELS, error: null });
      wire({ ai_models: chain });

      const resolved = await service.resolveModel(ECONOMY_ID, 'free');

      expect(resolved.record.id).toBe(ECONOMY_ID);
      expect(chain.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveModel', () => {
    it('resolves a client-chosen model allowed for the tier, exposing the provider route', async () => {
      wire({ ai_models: awaitedChain({ data: MODELS, error: null }) });

      const resolved = await service.resolveModel(ADVANCED_ID, 'premium');

      expect(resolved.record.id).toBe(ADVANCED_ID);
      expect(resolved.provider).toBe('gemini');
      expect(resolved.providerModel).toBe('gemini-2.5-pro');
    });

    it('falls back to the first enabled economy model for a free user asking for an advanced model', async () => {
      wire({ ai_models: awaitedChain({ data: MODELS, error: null }) });

      const resolved = await service.resolveModel(ADVANCED_ID, 'free');

      expect(resolved.record.id).toBe(ECONOMY_ID);
    });

    it('falls back when the modelId is unknown or points at a disabled model', async () => {
      wire({ ai_models: awaitedChain({ data: MODELS, error: null }) });

      const unknown = await service.resolveModel('44444444-4444-4444-8444-444444444444', 'premium');
      const disabled = await service.resolveModel(DISABLED_ID, 'premium');

      expect(unknown.record.id).toBe(ECONOMY_ID);
      expect(disabled.record.id).toBe(ECONOMY_ID);
    });

    it('uses the fallback when no modelId is given', async () => {
      wire({ ai_models: awaitedChain({ data: MODELS, error: null }) });

      const resolved = await service.resolveModel(undefined, 'free');

      expect(resolved.record.id).toBe(ECONOMY_ID);
    });

    it('defaults the provider to "default" when the row has none', async () => {
      wire({
        ai_models: awaitedChain({
          data: [modelRow({ provider: null, provider_model: null })],
          error: null,
        }),
      });

      const resolved = await service.resolveModel(undefined, 'free');

      expect(resolved.provider).toBe('default');
      expect(resolved.providerModel).toBeUndefined();
    });

    it('throws when the catalog is empty', async () => {
      wire({ ai_models: awaitedChain({ data: [], error: null }) });

      await expect(service.resolveModel(undefined, 'free')).rejects.toThrow(
        'No AI models are configured (ai_models table is empty).',
      );
    });

    it('maps a catalog load error to a descriptive Error', async () => {
      wire({
        ai_models: awaitedChain({ data: null, error: { message: 'relation missing' } }),
      });

      await expect(service.resolveModel(undefined, 'free')).rejects.toThrow(
        'Failed to load AI models: relation missing',
      );
    });
  });
});
