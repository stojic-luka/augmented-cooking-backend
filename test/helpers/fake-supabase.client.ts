import type { Mock } from 'vitest';
import type { AuthUser } from '@supabase/supabase-js';

export interface RpcError {
  code: string;
  message: string;
  details: null;
  hint: null;
}

export interface FakeSupabaseConfig {
  profile: { subscription_tier: string; tokens_remaining: number } | null;
  aiModels: Array<Record<string, unknown>>;
  /** `user_subscriptions` embed; null = no active subscription row. */
  activePlan: { plan: Array<Record<string, unknown>> } | null;
  /** `subscription_plans` lookup for billing; null = unknown plan. */
  plan: Record<string, unknown> | null;
  reserveRpc: { data: string; error: null } | { data: null; error: RpcError };
  completeRpc: { data: number; error: null } | { data: null; error: RpcError };
  releaseError: { message: string } | null;
  authUser: AuthUser | null;
  authError: { message: string } | null;
}

export function rpcError(code: string, message: string): RpcError {
  return { code, message, details: null, hint: null };
}

export interface CapturedCalls {
  reserveRpc: Array<Record<string, unknown>>;
  completeRpc: Array<Record<string, unknown>>;
  tableAccess: string[];
  releases: string[];
  getUserTokens: string[];
}

export interface FakeSupabaseClient {
  auth: { getUser: Mock };
  rpc: Mock;
  from: Mock;
  config: FakeSupabaseConfig;
  calls: CapturedCalls;
}

/** Tables the backend touches through the shared client. */
function queryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'delete', 'update', 'insert']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.single = vi.fn().mockResolvedValue(result);
  // `.select('*')` awaited directly on the builder
  // oxlint-disable-next-line unicorn/no-thenable -- the catalog awaits query builders directly
  chain.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

export const ECONOMY_MODEL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ADVANCED_MODEL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export function defaultFakeConfig(): FakeSupabaseConfig {
  return {
    profile: { subscription_tier: 'free', tokens_remaining: 0 },
    aiModels: [
      {
        id: ECONOMY_MODEL_ID,
        name: 'Flash',
        tier: 'economy',
        is_enabled: true,
        min_tier: 'free',
        provider: 'gemini',
        provider_model: 'gemini-2.5-flash',
      },
      {
        id: ADVANCED_MODEL_ID,
        name: 'Pro',
        tier: 'advanced',
        is_enabled: true,
        min_tier: 'premium',
        provider: 'gemini',
        provider_model: 'gemini-2.5-pro',
      },
    ],
    activePlan: { plan: [{ ai_actions_per_day: 30, tokens_per_month: 1000 }] },
    plan: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', is_active: true },
    reserveRpc: { data: 'usage-e2e-1', error: null },
    completeRpc: { data: 970, error: null },
    releaseError: null,
    authUser: null,
    authError: null,
  };
}

export function createFakeSupabaseClient(
  config: FakeSupabaseConfig = defaultFakeConfig(),
): FakeSupabaseClient {
  const calls: CapturedCalls = {
    reserveRpc: [],
    completeRpc: [],
    tableAccess: [],
    releases: [],
    getUserTokens: [],
  };

  const from = vi.fn((table: string) => {
    calls.tableAccess.push(table);
    switch (table) {
      case 'profiles':
        return queryChain({ data: config.profile, error: null });
      case 'ai_models':
        return queryChain({ data: config.aiModels, error: null });
      case 'user_subscriptions':
        return queryChain({ data: config.activePlan, error: null });
      case 'subscription_plans':
        return queryChain({ data: config.plan, error: null });
      case 'ai_usage_log': {
        // Reservation release; the eq('id', …) argument identifies the row.
        const deleteChain = queryChain({ data: null, error: config.releaseError });
        const originalEq = deleteChain.eq as Mock;
        (deleteChain as { eq: unknown }).eq = vi.fn((column: string, value: unknown) => {
          calls.releases.push(String(value));
          return originalEq(column, value);
        });
        return deleteChain;
      }
      default:
        throw new Error(`FakeSupabaseClient: unexpected table "${table}"`);
    }
  });

  const rpc = vi.fn(async (fn: string, params: Record<string, unknown>) => {
    if (fn === 'reserve_ai_usage') {
      calls.reserveRpc.push(params);
      return config.reserveRpc;
    }
    if (fn === 'complete_ai_usage') {
      calls.completeRpc.push(params);
      return config.completeRpc;
    }
    throw new Error(`FakeSupabaseClient: unexpected rpc "${fn}"`);
  });

  const getUser = vi.fn(async (token: string) => {
    calls.getUserTokens.push(token);
    return { data: { user: config.authUser }, error: config.authError };
  });

  return { auth: { getUser }, rpc, from, config, calls };
}
