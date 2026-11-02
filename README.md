# Augmented Cooking — API server

NestJS backend for Augmented Cooking. It is a **trusted helper** next to Supabase
(the system of record): AI recipe generation/editing/nutrition analysis, the
cooking-assistant chat, recipe scraping, grocery ordering, and the billing
placeholders. Every request authenticates with a Supabase access token
(`Authorization: Bearer <token>`), validated against the Supabase auth server.

Data access uses the **Supabase JS SDK only** (service-role key, server-side).
All balance/quota mutations happen inside the SECURITY DEFINER RPCs defined in
the database (`reserve_ai_usage`, `complete_ai_usage`, `apply_token_transaction`) —
never in application logic.

## Setup

```bash
$ npm install
$ cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (+ AI keys)
```

Run the database migration `supabase-migrations/20261017000000_ai_model_routing_and_free_cap.sql`
against your Supabase project (SQL editor, or copy into `supabase/migrations/`
and `supabase db push`). It adds the `provider`/`provider_model` routing columns
to `ai_models`, seeds a starter catalog, and sets the Free plan to 30 AI
actions/day.

```bash
# development (watch)
$ npm run start:dev

# production
$ npm run build && npm run start:prod
```

Typecheck and lint:

```bash
$ npm run typecheck   # tsc --noEmit over src/ AND test/ (tsconfig.typecheck.json)
$ npm run lint        # oxlint --type-aware (never mutates files)
```

Note: `nest build` is currently broken on the locked toolchain (TypeScript 6 +
`module: nodenext` requires explicit `./x.js` import extensions that the
source does not use). Tests, typecheck and lint all pass; repairing the
production build is a tracked, separate task.

## Testing

Tests run on **Vitest** (globals mode) with swc transforms so NestJS decorator
metadata survives (`unplugin-swc` — without it `Test.createTestingModule()`
cannot resolve DI). Coverage uses `@vitest/coverage-v8`.

```bash
$ npm run test        # unit specs (src/**/*.spec.ts, colocated)
$ npm run test:e2e    # contract specs (test/*.e2e-spec.ts) — real AppModule + fake Supabase
$ npm run test:cov    # unit specs with coverage
$ npm run test:watch  # watch mode
```

Conventions: mock Supabase seams with `vitest-mock-extended`
(`mockDeep<SupabaseClient>()`) plus the thenable `chain()` helper (see
`quota.repository.spec.ts`); mock AI SDKs with `vi.mock` factories
(`test/helpers/ai-fixtures.ts`); no real network, Supabase, AI calls, keys, or
wall-clock time — ever. Vitest does not typecheck; run `npm run typecheck`
alongside it (CI must do both).

## Environment variables

See [.env.example](./.env.example). Required: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. AI providers fail gracefully at request time when
their key is missing — the app boots and serves everything else.

## Endpoints (contract: clients/web/docs/API_ENDPOINTS.md)

| Method | Path                    | Purpose |
| ------ | ----------------------- | ------- |
| POST   | `/ai/generate-recipe`   | Generate a recipe draft from ingredients/constraints |
| POST   | `/ai/edit-recipe`       | Apply a natural-language change to a draft; returns edited draft + summary |
| POST   | `/ai/analyze-nutrition` | Estimate per-serving macros + healthier-alternative suggestions |
| POST   | `/ai/chat`              | Cooking assistant; client owns history (sends turns, persists the reply) |
| GET    | `/ai/models`            | Model catalog filtered by the caller's subscription tier (free = economy only) |
| POST   | `/recipes/import`       | Scrape a recipe from a public https URL; returns a draft (no AI, no quota) |
| POST   | `/orders`               | Place a grocery order through the partner port (mock until a real partner exists) |
| POST   | `/billing/subscribe`    | Placeholder plan-change intent; responds `{ status: "pending", message }` |
| POST   | `/billing/tokens`       | Placeholder token top-up intent; responds `{ status: "pending", message }` |

Conventions:

- Errors use meaningful HTTP status codes with a flat `{ code, message }` body
  (`{ message }` per the docs; `code` is an additive machine-readable id).
- `429` with `QUOTA_EXCEEDED` is the single status for every exhausted limit
  (free daily cap, premium token balance).
- Responses are returned **flat** — no envelope wrapper (the previous
  response-envelope interceptor was removed because it contradicted the docs
  and the frontend's Zod parsers).
- Drafts are validated on every boundary: AI output must parse against the
  draft schema (with one automated repair retry), client-sent drafts are
  validated before use.

## Quota rules

- **Free tier**: 30 AI actions per calendar day (UTC) — read from the active
  `subscription_plans.ai_actions_per_day`, fallback `FREE_DAILY_AI_ACTIONS` —
  and **economy models only**. A premium `modelId` is silently downgraded to
  the default economy model rather than rejected.
- **Premium**: unlimited AI actions; `/ai/chat` additionally debits the token
  balance by the tokens actually used (`complete_ai_usage`).
- Lifecycle per request: `reserve_ai_usage` → LLM call → `complete_ai_usage`.
  On provider failure the reservation row is deleted so abandoned slots do not
  burn the daily cap (the DB janitor sweep is the backstop).

## Modules

```
src/modules/
├── ai/         provider strategies (openai | gemini | ollama), strategy registry,
│               model catalog (ai_models table), validated-JSON executor, /ai/models
├── auth/       SupabaseAuthGuard (validates bearer tokens via auth.getUser)
├── billing/    subscribe + tokens placeholders (records intent, no payments)
├── chat/       POST /ai/chat (cooking assistant)
├── orders/     POST /orders + grocery-partner port (mock implementation)
├── quota/      RPC-driven quota lifecycle (reserve/complete/release)
├── recipe/     AI recipe endpoints + /recipes/import (scraper pipeline)
└── supabase/   global service-role Supabase client
```

Module pattern (established in `recipe/`, follow it for new modules):
`controllers/` per concern · `dtos/http/` (wire) + `dtos/service/` (internal) ·
`prompts/` · `repositories/` behind interfaces · `schemas/` · `services/`,
with DI tokens in `constants/` and a barrel `index.ts` per folder.

## Adding or swapping an AI provider / model

**Provider** (e.g. add `anthropic`):
1. Create `src/modules/ai/providers/anthropic.strategy.ts` extending
   `AiProviderStrategy` (`providerId`, `generateChat`, `generateStream`),
   reading its key from env in the constructor.
2. Register it in `AiModule` (`providers` + the `AI_PROVIDER_STRATEGIES_TOKEN`
   factory injects). The registry picks it up automatically.

**Model**: add a row to `ai_models` — `name`, `tier` (economy|advanced),
`min_tier` (free|premium), `provider` (strategy id), `provider_model`
(concrete model name at the provider). `/ai/models` exposes enabled rows
filtered by tier; `QuotaService` routes calls to the row's provider+model.

**Grocery partner**: implement `IGroceryPartner`
(`src/modules/orders/interfaces/`) and bind it to `GROCERY_PARTNER_TOKEN` in
`OrdersModule` in place of `MockGroceryPartnerService`.
