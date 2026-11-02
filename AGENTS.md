# AGENTS.md

Operating manual for AI coding agents working in this repository.
When this file conflicts with the code, follow the code's existing patterns and update this file.

## 1. What this app is

NestJS 12 backend for **Augmented Cooking** — a trusted helper next to Supabase,
which is the system of record. The server does what the client must not do:
hold the service-role key, talk to AI providers, enforce quota/billing rules,
and scrape third-party pages. Recipe/order/chat persistence happens **client-side
through Supabase (RLS)**; this server is mostly stateless request processing.

- Auth: Supabase bearer token, validated against the Supabase auth server.
- Data access: Supabase JS SDK only, service-role key (bypasses RLS — scope
  every query by user id in the repository).
- API contract (frozen): `../clients/web/docs/API_ENDPOINTS.md` — follow the
  docs on contract disagreements unless the code is clearly newer. The doc
  predates this server (it says the backend "does not exist yet"); shipped
  responses are a superset: `tokensUsed` is returned additively on
  generate/edit-recipe, and the recipe draft has **no** `caloriesPerServing`
  field (calories live only in the analyze-nutrition response). Don't trim
  fields to match the doc.
- Database reference: `../clients/web/docs/DATABASE_REFERENCE.md`.
- Web client (do not modify from here): `../clients/web`; desktop: `../clients/desktop`.

## 2. Hard rules

1. **Supabase SDK only for data access.** No Prisma/TypeORM/kysely. Repositories
   inject `SUPABASE_CLIENT` (Symbol token) from `@modules/supabase` (global,
   service-role — queries must be scoped by user id in the repository).
2. **Quota/balance mutations only via the DB RPCs** (`reserve_ai_usage`,
   `complete_ai_usage`, `apply_token_transaction`) — never count-then-act in
   application code. Lifecycle: reserve → call the LLM → complete; on provider
   failure, release the reservation (deletes the row).
3. **AI output is never trusted.** Parse/validate against zod schemas in
   `modules/ai/ai.models.ts` via `AiJsonService.generateValidated`, which
   retries once with a repair prompt. Prompts live in the consuming module
   (`prompts/` folder, or a single `prompts.ts`).
4. **Errors: meaningful status + flat `{ message }` body** (the documented
   contract), plus an additive machine-readable `code` (`ApiException`
   subclasses in `src/common/exceptions/`). Responses are returned **flat** —
   there is NO envelope wrapper (it was removed deliberately: it contradicted
   the docs and the frontend's zod parsers). `GET /ai/models` returning
   `{ models: [...] }` is the documented payload shape, not an envelope.
5. **Every AI-consuming endpoint goes through `QuotaService`**; `429
   QUOTA_EXCEEDED` is the one status for exhausted limits.
6. **Module anatomy** — see §7 and copy `modules/recipe/`.
7. **DI tokens use `useExisting`, not `useClass`** — `useClass` silently
   instantiates a second instance.
8. **Auth**: `SupabaseAuthGuard` on every controller; user via
   `@GetCurrentUser()`, abort signal via `@GetAbortSignal()` (requires the
   global `RequestCancellationInterceptor`, which `AppModule` registers).
9. **SSRF discipline for outbound fetches**: https only, no credentials in
   URLs, resolve DNS and reject private/loopback/link-local/reserved addresses
   on every redirect hop (`UrlGuardService` + `RecipeHtmlFetcherService`).
10. **Tests run in-repo, no real network.** Unit specs (`*.spec.ts`, colocated)
    via `npm run test`; e2e contract specs via `npm run test:e2e`. Before
    finishing: `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm run
    build`, and a boot smoke test (§5).

## 3. Tech stack

| Concern | Choice |
| --- | --- |
| Framework | NestJS 12 (`@nestjs/common` ^12), Express platform, Node ≥ 20 |
| Language | TypeScript 6.0, `module: nodenext`, `target: ES2023`, decorators on, `strictNullChecks` on, `noImplicitAny` **off** |
| Config | `@nestjs/config` with three `registerAs` namespaces (`Global`, `Supabase`, `Ai`) |
| Validation | `class-validator` + `class-transformer` (wire DTOs); `zod` v4 (AI output, DB rows) |
| Data | `@supabase/supabase-js` v2 only — no ORM |
| AI SDKs | `openai` v7 (also used for Ollama), `@google/genai` v2 |
| Scraping | `recipe-scrapers` v3 (ESM-only), `cheerio`, `parse-ingredient` |
| Tests | Vitest 4 (`globals: true`), `unplugin-swc` + `@swc/core` (decorator metadata), `vitest-mock-extended`, `supertest`, `@nestjs/testing`, `@vitest/coverage-v8` |
| Lint | oxlint `--type-aware` (tsgolint) + `.oxlintrc.json` overrides |
| Package manager | npm (there is a `package-lock.json`; no yarn/pnpm lock) |

## 4. Prerequisites & setup

```bash
npm install
cp .env.example .env   # fill in SUPABASE_PROJECT_URL + SUPABASE_SERVICE_ROLE_KEY (+ AI keys)
```

- Required to boot: `SUPABASE_PROJECT_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the Supabase
  module uses `getOrThrow`; a URL that isn't URL-shaped fails at boot because
  supabase-js validates it). AI keys are **not** required to boot — providers
  fail per-request with `AiUnavailableException`, and the Gemini SDK logs a
  benign "API key should be set…" warning at startup. `OLLAMA_BASE_URL` must be
  set for ollama-routed models — unset, the strategy fails per request with
  `AiUnavailableException` (it never falls back to the OpenAI cloud endpoint).
- DB schema: apply `supabase/migrations/20261017000000_ai_model_routing_and_free_cap.sql`
  (model routing columns + `ai_models` seed + Free plan cap) on top of the base
  schema in `../clients/web/docs/`.
- Run locally: `npm run start:dev` (watch) — listens on `PORT` or 3000.

## 5. Commands

All exist in `package.json` (verified):

| Command | Does |
| --- | --- |
| `npm run build` | `nest build` → `dist/` (works on the current toolchain; see the note below) |
| `npm run start` / `start:dev` / `start:debug` | `nest start` (+ `--watch` / `--debug --watch`) |
| `npm run start:prod` | `node dist/main` |
| `npm run lint` | oxlint `--type-aware` (does **not** mutate files; reads `.oxlintrc.json`) |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` — typechecks `src/` **and** `test/` |
| `npm run format` | prettier --write on `src/**` + `test/**` |
| `npm run test` | Vitest unit specs (`*.spec.ts`, colocated) via `vitest.config.ts` |
| `npm run test:watch` / `test:cov` / `test:debug` | watch / coverage (`@vitest/coverage-v8`) / inspect-brk |
| `npm run test:e2e` | Vitest with `vitest.config.e2e.ts` (`test/*.e2e-spec.ts`) |

**Build note (historical):** `nest build` previously failed on the
TypeScript 6.0.3 + `module: nodenext` toolchain (~262 errors: extensionless
relative imports, `baseUrl` for alias paths). On the current toolchain
(Nest CLI 12 / TS 6.0) it compiles clean — verified 2026-10-24 with a boot
smoke test. The `tsconfig.typecheck.json` (`moduleResolution: "bundler"`, no
`baseUrl`, includes `src` + `test`) and the per-directory
`src/tsconfig.json` / `test/tsconfig.json` shims for oxlint discovery remain
in place and should not be removed.

Boot smoke test (after `npm run build`):

```bash
SUPABASE_PROJECT_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=dummy node dist/main.js
```

It must start and map 9 routes (`/ai/models`; `/ai/generate-recipe`,
`/ai/edit-recipe`, `/ai/analyze-nutrition`, `/ai/chat`; `/recipes/import`;
`/orders`; `/billing/subscribe`, `/billing/tokens`). The green e2e suite is
the fuller gate: it compiles the real `AppModule` and exercises every route.

## 6. Environment variables

From `.env.example` and `src/lib/config/*`:

| Var | Purpose | Required |
| --- | --- | --- |
| `PORT` | Listen port (read directly by `main.ts`; default 3000) | no |
| `NODE_ENV` | `Global.Environment`; default `development` | no |
| `CORS_ORIGIN` | Loaded into config but **currently unused** — `main.ts` calls `app.enableCors()` with no args (all origins allowed) | no |
| `SUPABASE_PROJECT_URL` | Project URL (`https://<ref>.supabase.co`); format-validated at boot | **yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key; bypasses RLS; server-side only, never expose/log/commit | **yes** |
| `AI_DEFAULT_PROVIDER` | Fallback provider when an `ai_models` row has no provider: `openai \| gemini \| ollama` (default `gemini`) | no |
| `FREE_DAILY_AI_ACTIONS` | Free-cap fallback when the user has no active plan row (default 30) | no |
| `GEMINI_API_KEY` | Used when a model's provider is `gemini` | for gemini calls |
| `OPENAI_API_KEY` | Used when a model's provider is `openai` | for openai calls |
| `OLLAMA_BASE_URL` / `OLLAMA_API_KEY` | OpenAI-compatible Ollama endpoint | for ollama calls |

Provider strategies read their keys directly via `ConfigService.get('OPENAI_API_KEY')`
etc. — **unnamespaced**, unlike the `Global.`/`Supabase.`/`Ai.` namespaces.

## 7. Architecture map

### Bootstrap & request pipeline

`src/main.ts` is minimal: `NestFactory.create(AppModule)`, `app.enableCors()`,
listen on `process.env.PORT ?? 3000`. **All global wiring lives in
`AppModule`** (`APP_PIPE`, `APP_INTERCEPTOR`, `APP_FILTER` providers), so e2e
harnesses that compile `AppModule` get the identical pipeline:

- `ValidationPipe({ whitelist: true, transform: true, transformOptions:
  { enableImplicitConversion: false } })` — undecorated properties are
  stripped; numbers need explicit `@Type(() => Number)`.
- `RequestCancellationInterceptor` — creates an `AbortController` per request,
  aborts on client disconnect; feeds `@GetAbortSignal()`.
- `ApiExceptionFilter` — every error exits as `{ code, message }` with the
  exception's status (unknown errors → 500 `{ code: 'ERR', message }`;
  class-validator message arrays are joined with `'; '`).

### Source tree

```
src/
├── main.ts, app.module.ts        bootstrap + global pipe/interceptor/filter
├── common/
│   ├── decorators/request/       @GetCurrentUser, @GetAbortSignal
│   ├── decorators/pagination/    @DecodeCursor (not yet used by any endpoint)
│   ├── transformers/pagination/  encode/decode cursor (base64 "uuid_timestamp", strict validation)
│   ├── filters/                  ApiExceptionFilter
│   ├── interceptors/request/     RequestCancellationInterceptor
│   ├── exceptions/               ApiException + per-domain folders: ai/ auth/ quota/ recipe/
│   ├── types/                    Express.Request augmentation (abortSignal)
│   └── (specs colocated)
├── lib/
│   ├── config/                   global.config, supabase.config, ai.config (registerAs)
│   └── recipe-scrapers/          ESM loader for recipe-scrapers (native.mts → import())
├── utils/                        getErrorMessage
└── modules/
    ├── supabase/   @Global module providing SUPABASE_CLIENT (service-role, no session persistence)
    ├── auth/       SupabaseAuthGuard (validates bearer via supabase.auth.getUser; no passport)
    ├── quota/      RPC-driven quota lifecycle (reserve/complete/release) + QuotaRepository
    ├── ai/         provider strategies, strategy registry, model catalog, AiJsonService, /ai/models
    ├── recipe/     /ai/generate-recipe|edit-recipe|analyze-nutrition + /recipes/import (scraper pipeline)
    ├── chat/       POST /ai/chat (cooking assistant; client owns history)
    ├── orders/     POST /orders via IGroceryPartner port — MockGroceryPartnerService (no real partner)
    └── billing/    POST /billing/subscribe|tokens — placeholders returning { status: "pending" }
```

No module is empty; `billing` and the orders partner are deliberate
placeholders/mocks (contract-shaped, no real integration).

### Module anatomy (canonical: `modules/recipe/`)

```
modules/recipe/
├── recipes.module.ts          wiring; imports AiModule + QuotaModule
├── constants/index.ts         DI tokens (Symbol): RECIPE_AI_SERVICE_TOKEN, …
├── controllers/               one per concern (RecipeAiController @Controller('ai'),
│                              RecipesController @Controller('recipes'))
├── dtos/http/                 wire DTOs — classes with class-validator decorators (*BodyDto)
├── dtos/service/              service-layer params/results — plain interfaces (no decorators)
├── interfaces/                IRecipeAiService, IRecipeImportService (+ params interfaces)
├── prompts/                   exported const prompt strings, one file per prompt
├── schemas/                   JSON schemas for providers + zod-based parsers/mappers
├── services/                  implementations
└── index.ts + barrel per folder
```

**Creating a new module:**

1. `constants/index.ts`: `export const X_SERVICE_TOKEN = Symbol('X_SERVICE');`
2. `dtos/http/` classes for the wire; `dtos/service/` interfaces for internals.
   Service params always include `userId` and `signal: AbortSignal`.
3. `interfaces/` for the service contract; implement it in `services/`.
4. `prompts/` (AI modules only); JSON schema + parse function in `schemas/`.
5. Repositories (if any data access) inject `SUPABASE_CLIENT` and scope by
   user id; type RPC/embed results explicitly at this boundary.
6. Module: provide the service class **and** bind the token with
   `useExisting`; export only the token (plus classes when other modules need
   the concrete type). Controllers: `@UseGuards(SupabaseAuthGuard)`, inject the
   **token** as the interface, `@HttpCode` per route, map body → service params
   explicitly.
7. Export a curated root `index.ts` (module, tokens, types consumers need).

### HTTP surface (all guarded, all verified in boot log)

| Route | Controller | Returns (flat) |
| --- | --- | --- |
| `POST /ai/generate-recipe` (201) | RecipeAiController | `{ recipe, tokensUsed }` |
| `POST /ai/edit-recipe` (200) | ″ | `{ recipe, summary, tokensUsed }` |
| `POST /ai/analyze-nutrition` (200) | ″ | nutrition analysis object |
| `POST /recipes/import` (201) | RecipesController | `{ recipe }` — scraping, no AI, no quota |
| `POST /ai/chat` (200) | ChatController | `{ reply, tokensUsed }` |
| `GET /ai/models` (200) | AiModelsController | `{ models: [...] }` filtered by caller tier |
| `POST /orders` (201) | OrdersController | `{ orderId, status }` |
| `POST /billing/subscribe` (202) | BillingController | `{ status: 'pending', message }` |
| `POST /billing/tokens` (202) | ″ | `{ status: 'pending', message }` |

## 8. Conventions

### DTOs & validation

- `dtos/http/` = class-validator classes (`GenerateRecipeBodyDto`), decorated
  field-by-field with sizes/maxima and custom messages; remember
  `@Type(() => Number)` for numeric query/body fields (implicit conversion off).
- `dtos/service/` = plain interfaces (`GenerateRecipeDto` + `…Result`).
  Controllers never pass the wire DTO into services; they map explicitly.
- Client-sent drafts (`edit-recipe`, `analyze-nutrition`) are re-validated
  server-side with `parseClientRecipeDraft` (strict) → 400 on garbage.

### Errors

- Throw `ApiException` subclasses from `@exceptions/index`; domain folders:
  `AiUnavailableException`/`AiResponseInvalidException` (502),
  `InvalidAccessTokenException` (401), `QuotaExceededException` (429,
  `QUOTA_EXCEEDED` — the only status for exhausted limits),
  `InvalidRecipeUrlException` (400) / `RecipeImportException` (502).
- Don't hand-format error bodies; the global filter owns the shape.

### Auth

- `SupabaseAuthGuard` is a plain `CanActivate` (no passport): Bearer token →
  `supabase.auth.getUser(token)` (a network call — Supabase is the source of
  truth for signature + revocation) → `request.user`. Handlers read
  `@GetCurrentUser() user: AuthUser` and use `user.id`.
- There is **no role/RBAC decorator system**. Subscription tier (`free` /
  `premium`) is data, read from `profiles.subscription_tier` via
  `AiModelCatalogService.getTier`; unknown profiles are treated as free.

### Data access

- Only via the shared `SUPABASE_CLIENT`. Without generated DB types queries
  return `any` — cast/zod-parse at the repository boundary (see
  `QuotaRepository.getActivePlan` for the one-to-many embed that may arrive as
  array or object).

### AI strategy + registry pattern

```
modules/ai/
├── contracts/ai-provider.strategy.ts   abstract AiProviderStrategy: providerId, generateChat, generateStream
├── providers/{openai,gemini,ollama}.strategy.ts   SDK wrappers; read own env keys; abort-signal aware
├── registries/ai-strategy.registry.ts  Map<providerId, strategy>; getOrThrow → 400 listing active engines
├── services/ai.service.ts              IAiService facade delegating to the registry (AI_SERVICE_TOKEN)
├── services/ai-json.service.ts         generateValidated: JSON-schema call → zod parse → ONE repair retry
├── services/ai-model-catalog.service.ts  ai_models table (30s in-process TTL cache; failures/empty never cached); tier gating; resolveModel
└── ai.models.ts                        zod schemas + types shared with consumers (RecipeDraft, …)
```

- Provider selection: `ai_models.provider` column → route. The catalog returns
  the sentinel `'default'` when the column is null; **callers must translate
  `'default'` to `undefined`** so `AiJsonService` falls back to
  `AI_DEFAULT_PROVIDER`.
- Missing provider keys don't crash boot; the call fails with
  `AiUnavailableException`. Strategies pass `options.signal` into the SDK.
- Adding a provider: subclass `AiProviderStrategy`, register it in `AiModule`
  providers and in the `AI_PROVIDER_STRATEGIES_TOKEN` factory inject array —
  the registry picks it up automatically. Adding a model: insert an `ai_models`
  row (`tier`, `min_tier`, `provider`, `provider_model`).

### Quota lifecycle (every AI endpoint)

```ts
const reservation = await this.quotaService.reserve({ userId, action, modelId }); // 429 on cap
try {
  const { data, usage, model } = await this.aiJson.generateValidated({ ... });
  await this.quotaService.complete({ reservation, model, ...usage }); // debits premium chat tokens
  return result;
} catch (error) {
  await this.quotaService.release(reservation); // never burn the cap on failure
  throw error;
}
```

- Free tier: N actions/day (active plan's `ai_actions_per_day`, fallback
  `FREE_DAILY_AI_ACTIONS`), **economy models only** — a premium `modelId` is
  silently downgraded to the default economy model, never rejected.
- Premium: unlimited actions; `/ai/chat` additionally debits tokens actually
  used (`complete_ai_usage`).
- `modelId` is client-chosen but never trusted: `resolveModel` requires it to
  exist, be enabled, and be allowed for the tier.

### Pagination

Cursor infra exists in `common/` (base64 `uuid_timestamp`, strict decode →
400 on tampering) but **no endpoint uses it yet**. If you build a list
endpoint, use `@DecodeCursor()` + the encode transformer rather than inventing
a new scheme.

## 9. Testing guide

Runner: **Vitest 4** (`globals: true` — bare `describe`/`it`/`expect`/`vi`,
typed via `"types": ["vitest/globals"]` in tsconfig). Unit specs are colocated
(`*.spec.ts` next to the code, matched by `vitest.config.ts`); e2e contract
specs live in `test/*.e2e-spec.ts` with helpers in `test/helpers/`, matched by
the separate `vitest.config.e2e.ts`. Path aliases resolve through Vite 8's
native `resolve: { tsconfigPaths: true }` — no per-config alias mapping to
maintain.

- **unplugin-swc is mandatory.** Vitest's default transform cannot emit
  decorator metadata, and NestJS DI reads `design:paramtypes` — without the
  swc plugin every `Test.createTestingModule()` dies with "Nest can't resolve
  dependencies". The plugin reads `tsconfig.json` and maps
  `experimentalDecorators`/`emitDecoratorMetadata` onto swc's
  `legacyDecorator`/`decoratorMetadata`; it is registered in both Vitest
  configs. Do not remove it.
- **Vitest does not typecheck.** Test runs transform with swc only. Run
  `npm run typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`,
  `moduleResolution: "bundler"`, includes `src` **and** `test`) as a separate
  gate — CI must do both.
- **Unit specs**: instantiate the class directly. Supabase seams use
  `mockDeep<SupabaseClient>()` from `vitest-mock-extended` (same API as
  jest-mock-extended; only the import differs), plus a hand-rolled query
  `chain()` helper. The chain must be **thenable** — the codebase awaits
  builders directly (`.select('*')` without `.single()`), so a mock without
  `then` hangs. See `quota.repository.spec.ts` for the pattern.
- **AI SDKs**: `vi.mock('openai', …)` / `vi.mock('@google/genai', …)` at the
  top of specs that construct strategies; `test/helpers/ai-fixtures.ts` has
  `installGeminiMock()` and reusable valid payloads (`AI_RECIPE_DRAFT`).
  Vitest calls `mockImplementation` implementations with `new` when the mock
  is constructed — the implementation must be a `function`, not an arrow
  (arrows are not constructible; Jest used to wrap them).
- **Fake timers** for clock-derived logic: `vi.useFakeTimers({ now: … })`
  (see `orders.service.spec.ts`).
- **e2e**: `test/helpers/e2e-app.ts` compiles the real `AppModule` (so the
  global pipe/interceptor/filter apply) with two overrides: `SUPABASE_CLIENT`
  → `createFakeSupabaseClient()` (table/rpc routing, captured calls, mutable
  `config`), and the guard → either `TestAuthGuard` (stamps a fake user;
  `createTestApp`) or the real `SupabaseAuthGuard` against the fake's
  `auth.getUser` (`createRealGuardApp`). Dummy `SUPABASE_PROJECT_URL`/`KEY` env
  values are set in the helper for `getOrThrow`.
- **Rules**: no real network, no real Supabase, no real AI calls, no real keys
  — ever. E2e specs assert the documented wire contract (status + flat body),
  including error shapes.

## 10. Lint & typecheck

- `npm run lint` runs `oxlint --type-aware` (tsgolint) over `src/` and
  `test/`. It never mutates files. `.oxlintrc.json` disables the
  unsafe-*/unbound-method rules for `**/*.spec.ts` and `test/**` (mock-heavy
  seams); the one production warning (`main.ts` bootstrap floating promise)
  is known.
- oxlint discovers the **nearest** tsconfig per file; `src/tsconfig.json` and
  `test/tsconfig.json` extend `tsconfig.typecheck.json`
  (`moduleResolution: "bundler"`, no `baseUrl`) because the root
  `tsconfig.json` still carries the production `baseUrl` that oxc rejects.
- Prettier (`.prettierrc`): `singleQuote`, `trailingComma: "all"`,
  `printWidth: 100` — run via `npm run format`.
- `npm run typecheck` covers `src` **and** `test`; Vitest itself does not
  typecheck anything.

## 11. Security rules

- The Supabase client carries the **service-role key and bypasses RLS**:
  never return it, log it, or put it in any response; never commit `.env`
  (gitignored). Scope every query by the authenticated user's id.
- Never log or echo raw provider errors that could embed keys; map them to
  `ApiException` messages.
- Secrets never travel in URLs (also an SSRF rule: reject URLs containing
  credentials).
- Outbound fetches only through the `UrlGuardService`/`RecipeHtmlFetcherService`
  path — https, no credentials, DNS-resolved private-range rejection per hop,
  redirect/size/timeout caps.
- AI output and client payloads are validated at every boundary; `modelId` and
  `planId` are always re-checked server-side.

## 12. Gotchas (things agents get wrong on the first try)

- **No response envelope.** Don't wrap responses or add a
  response-transform interceptor; it existed and was removed on purpose.
- **`useClass` vs `useExisting`**: `useClass` builds a second instance;
  every token binding here is `useExisting`.
- **The Supabase mock chain must be thenable.** `mockDeep` alone won't
  resolve awaited builders; copy the `chain()` helper from an existing spec.
- **Path aliases live in tsconfig paths only.** Vitest resolves them via
  Vite 8's `resolve: { tsconfigPaths: true }` in both configs — add the alias
  to `tsconfig.json` (and mirror it into `tsconfig.typecheck.json` only if you
  deviate from the root paths) and every runner picks it up.
- **`recipe-scrapers` is ESM-only**; import it only through
  `src/lib/recipe-scrapers` (the `.mts` loader keeps a native dynamic
  `import()` in the compiled output). Its peer deps (`cheerio`,
  `parse-ingredient`, `zod`) are required installs. `uuid` v14 is ESM-only too
  but needs **no stub under Vitest** — the old Jest stub was removed.
- **`ai_models` rows that fail zod validation are silently dropped** from the
  catalog — a malformed seed row makes a model vanish without errors.
- **`provider: 'default'` is a sentinel, not a provider id.** Translate it to
  `undefined` before calling strategies, or the registry throws 400.
- **Free-tier premium-model requests are silently downgraded**, not rejected —
  don't add an error for that.
- **Port/global config**: `main.ts` reads `process.env.PORT` directly;
  `Global.Port` in config exists but nothing consumes it.
- **`CORS_ORIGIN` is dead config** — CORS is currently all-origins.
- **Boot-time Gemini warning** ("API key should be set…") is benign noise when
  `GEMINI_API_KEY` is unset.
- **Guard tests**: the real `SupabaseAuthGuard` makes a network call — always
  back it with the fake client (`createRealGuardApp`), never point tests at a
  real project.
- **`@GetAbortSignal()` needs the global interceptor.** Any custom bootstrap
  (scripts, alternative mains) must register `RequestCancellationInterceptor`
  or the signal is undefined.
- **Quota errors are matched by RPC message text** (`DAILY_CAP_REACHED`,
  `INSUFFICIENT_TOKENS`) — don't rename those strings in the DB layer without
  updating `QuotaService.mapQuotaError`.

## 13. Pointers — read first

1. `../clients/web/docs/API_ENDPOINTS.md` — the API contract (frozen).
2. `../clients/web/docs/DATABASE_REFERENCE.md` — tables, RPCs, RLS.
3. `README.md` — setup, endpoint table, quota rules, and the walkthroughs for
   swapping the grocery partner / adding AI providers & models.
4. `modules/recipe/` — canonical module anatomy to copy.
5. `test/helpers/` — the e2e harness and fake Supabase client to reuse.
