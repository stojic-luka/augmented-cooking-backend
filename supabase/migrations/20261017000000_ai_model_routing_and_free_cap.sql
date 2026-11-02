-- AI model routing + quota cap alignment for the NestJS backend.
--
-- Where to run: Supabase SQL editor (or `supabase db push` after copying
-- this file into the project's supabase/migrations/ folder). Idempotent.
--
-- 1. Adds routing columns to `ai_models` so each catalog row names the
--    provider strategy (openai | gemini | ollama) and the concrete model id
--    to call. `min_tier` decides who may use it; `tier` stays a display hint.
-- 2. Seeds a small catalog (fixed UUIDs keep re-runs idempotent).
-- 3. Aligns the Free plan's daily action cap with the documented product
--    rule (30 AI actions/day).

alter table public.ai_models
  add column if not exists provider text,
  add column if not exists provider_model text;

insert into public.ai_models (id, name, tier, is_enabled, min_tier, provider, provider_model) values
  ('10000000-0000-0000-0000-000000000001', 'Gemini 2.5 Flash', 'economy',  true, 'free',    'gemini', 'gemini-2.5-flash'),
  ('10000000-0000-0000-0000-000000000002', 'Gemini 2.5 Pro',   'advanced', true, 'premium', 'gemini', 'gemini-2.5-pro'),
  ('10000000-0000-0000-0000-000000000003', 'GPT-4.1 mini',     'economy',  true, 'free',    'openai', 'gpt-4.1-mini'),
  ('10000000-0000-0000-0000-000000000004', 'GPT-4.1',          'advanced', true, 'premium', 'openai', 'gpt-4.1'),
  ('10000000-0000-0000-0000-000000000005', 'Llama 3 (local)',  'economy',  true, 'free',    'ollama', 'llama3')
on conflict (id) do update
  set provider       = excluded.provider,
      provider_model = excluded.provider_model,
      tier           = excluded.tier,
      min_tier       = excluded.min_tier,
      is_enabled     = excluded.is_enabled;

update public.subscription_plans
   set ai_actions_per_day = 30
 where id = '00000000-0000-0000-0000-000000000001'
   and ai_actions_per_day is distinct from 30;
