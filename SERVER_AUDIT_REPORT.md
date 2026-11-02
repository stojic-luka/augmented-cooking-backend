# Server Audit & Repair Report — 2026-10-24

Full-codebase audit-and-repair run over `server/` (NestJS backend for Augmented
Cooking), executed as: audit → bug fixes → tests → optimization → verification.

## Executive summary

| Metric | Result |
| --- | --- |
| Bugs found | 17 (4×P1, 5×P2, 8×P3) |
| Bugs fixed | 10 (all P1, all P2, 1 trivial P3) |
| Bugs deferred to recommendations | 7 (all P3 — see Leftovers) |
| Regression tests added | 11 (9 unit, 2 e2e) covering every fixed bug |
| Optimization tests added | 2 (catalog cache behavior) |
| Optimizations applied | 2 |
| Schema changes | 0 (none needed — verified existing indexes cover the quota query) |
| New runtime dependencies | 0 |
| Final gates | typecheck ✅ · lint 0 warnings / 0 errors ✅ · clean `nest build` ✅ · boot smoke ✅ · unit 192/192 ✅ · e2e 53/53 ✅ |
| API contract | Unchanged — every route/method/status/shape verified against `../clients/web/docs/API_ENDPOINTS.md` by the e2e suite before and after |

Commits (repo had **no git history**; one was initialized for this run, with the
object store kept outside the workspace at `~/.augmented-cooking-server-git`
after `.git` was deleted mid-run by something outside this session):

1. `chore: baseline before audit-and-repair run`
2. `fix: resolve 10 bugs found in audit (P0:0, P1:4, P2:5, P3:1)`
3. `test: add 11 regression tests for audit fixes (A1-A8)`
4. `perf: apply 2 optimizations from audit`
5. `docs: add server audit report`

## Environment profile

| Concern | Finding |
| --- | --- |
| Runtime | Node 24.22, npm 11.19 (lockfile: `package-lock.json`) |
| Framework | **NestJS 12.2** (`@nestjs/common` ^12) — package.json is newer than AGENTS.md claimed (Nest 11); docs updated |
| Language | TypeScript 6.0, `module: nodenext` (prod tsconfig) / `bundler` (typecheck tsconfig), decorators on |
| Data layer | `@supabase/supabase-js` v2 only — **no ORM**; Postgres via Supabase; quota mutations exclusively through SECURITY DEFINER RPCs (`reserve_ai_usage`, `complete_ai_usage`, `apply_token_transaction`) |
| Migrations | `supabase/migrations/20261017000000_ai_model_routing_and_free_cap.sql` (additive model-routing columns + seed); base schema in `../clients/web/docs/DATABASE_REFERENCE.md` — in sync with code usage; required indexes exist (`ai_usage_log (user_id, created_at desc)` etc.) |
| Queue/broker | none |
| Auth | Supabase bearer token → `SupabaseAuthGuard` (plain `CanActivate`, validates via `supabase.auth.getUser`) applied per-controller; no passport/RBAC; tier read from `profiles.subscription_tier` |
| Config | `@nestjs/config` with 3 `registerAs` namespaces (`Global`, `Supabase`, `Ai`); provider keys read unnamespaced; `.env` gitignored |
| Tests | Vitest 4 (`globals: true`) + unplugin-swc (decorator metadata) + vitest-mock-extended + supertest; unit specs colocated; e2e compiles the real `AppModule` with a fake Supabase client — **no real network/DB/AI ever touched** |
| Lint | oxlint `--type-aware` |
| Build | `nest build` **works** on the current toolchain (AGENTS.md's "known breakage" paragraph was stale; removed) |
| Topology | 8 modules (supabase, auth, quota, ai, recipe, chat, orders, billing), 6 controllers, 9 routes; global pipe/interceptor/filter declared in `AppModule`; no websockets/cron/intersceptors per-request state (all providers singleton + stateless or explicitly per-request) |

## Bugs — Inventory A

### Fixed (Phase 1)

| id | sev | location | root cause | fix | verification |
| --- | --- | --- | --- | --- | --- |
| A1 | P1 | `src/modules/quota/services/quota.service.ts` | `computeTokenCost` charged premium users `tokensUsed` for **every** action, contradicting the documented rule (AGENTS.md, `IQuotaService.complete` docstring, DATABASE_REFERENCE.md): only `/ai/chat` is token-metered. Premium recipe actions drained the chat-token balance and could fail 429 `INSUFFICIENT_TOKENS`. | `QuotaReservation` now carries `action`; cost is `premium && action === 'chat' ? tokensUsed : 0` | unit: "charges nothing for premium non-chat actions"; e2e: premium generate-recipe asserts `p_token_cost: 0`; existing premium-chat `p_token_cost: 120` e2e still green |
| A2 | P1 | `src/modules/quota/services/quota.service.ts` | `mapQuotaError` condition `code === 'P0001' \|\| message` is true for **any** error with a message → every reserve failure (DB outage, network) became 429 `QUOTA_EXCEEDED` with a misleading upgrade prompt; outages invisible to monitoring. | map only `DAILY_CAP_REACHED` / `INSUFFICIENT_TOKENS` message signals; everything else propagates (→ 500 via filter) | unit: "propagates non-quota reserve failures untouched"; e2e: `XX000 db down` → 500 `{code:'ERR', message:'db down'}`. Two spec cases that asserted the buggy mapping were corrected (they enshrined the bug). |
| A3 | P1 | `src/modules/quota/services/quota.service.ts` | `resolveModel` ran **after** `reserveAiUsage` and outside the failure path — a catalog failure (bad `ai_models` read, empty catalog) leaked a reservation row that counts against the caller's daily cap until the (external, possibly unscheduled) janitor sweep. | reordered: tier → resolveModel (read-only) → plan cap → reserve RPC, so no reservation exists until everything read-only succeeded | unit: "resolves the model before reserving, so a catalog failure leaves no reservation behind" (`reserveAiUsage` not called) |
| A4 | P1 | `src/modules/chat/services/chat.service.ts` | default-provider fallback hardcoded `'gemini'`, ignoring `AI_DEFAULT_PROVIDER` (AGENTS.md: callers must translate the `'default'` sentinel). With `AI_DEFAULT_PROVIDER=openai`, chat still hit gemini. | reads `Ai.DefaultProvider` via `ConfigService` (fallback `'gemini'`) | unit: "honors AI_DEFAULT_PROVIDER for the 'default' placeholder"; existing gemini-fallback test still green |
| A5 | P2 | `src/modules/ai/providers/ollama.strategy.ts` | with `OLLAMA_BASE_URL` unset, the OpenAI SDK defaults to `https://api.openai.com/v1` — "Ollama" calls (recipe/chat payloads) were silently sent to OpenAI's cloud with a bogus key. | strategy stores the base URL and fails fast per call with `AiUnavailableException` before touching the SDK (matches the "missing keys fail per request" convention) | unit: "fails fast when OLLAMA_BASE_URL is not configured" (SDK `create` never called) |
| A6 | P2 | `src/modules/ai/services/ai-model-catalog.service.ts` | `getTier` ignored the select `error` — any DB failure silently treated premium users as free (economy downgrade + daily cap). | throws `Failed to load subscription tier: …` (→ 500); unknown profiles still treated as free (documented) | unit: "throws on a failed profile lookup instead of silently treating the user as free" |
| A7 | P2 | `src/modules/billing/services/billing.service.ts` | `subscribe` ignored the select `error` — a DB outage returned 400 "Unknown or inactive plan." | throws on error (→ 500); genuine unknown/inactive plans still 400 | unit: "surfaces a failed plan lookup as an error instead of 400 unknown plan" |
| A8 | P2 | `recipe-ai.service.ts` (3 catch blocks), `chat.service.ts` | `await release(reservation); throw error;` — if the release RPC itself failed (DB down), the release error **replaced** the original error (a 502 provider failure surfaced as a confusing 500). | `releaseQuietly()`: release wrapped in try/catch, logs a warning with the reservation id, original error always wins | unit ×2 (recipe + chat): "still throws the original error when releasing the reservation fails" |
| A9 | P2 | `test/helpers/e2e-app.ts` | harness set `SUPABASE_URL`, but the config namespace reads `SUPABASE_PROJECT_URL` — the suite only booted because a local `.env` supplied the right var; on a clean checkout e2e died at `getOrThrow`. | sets `SUPABASE_PROJECT_URL` | suite boots green (all 53 e2e) |
| A10 | P3 | `src/main.ts` | floating `bootstrap()` promise — the repo's only lint warning | `void bootstrap();` | lint now 0 warnings / 0 errors |

### Found but NOT fixed (deliberate — report-only)

| id | sev | location | issue | why deferred |
| --- | --- | --- | --- | --- |
| A11 | P3 | `src/main.ts` | no `enableShutdownHooks()` (graceful SIGTERM drain) | zero observable effect today (no `onModuleDestroy`/open handles registered anywhere); adding signal handlers is a behavior change best made deliberately with a deployment story |
| A12 | P3 | `quota.repository.ts` / `url-guard.service.ts` | dead code: `QuotaRepository.getProfile` and `UrlGuardService.isHostSafe` have no production callers | removal touches spec files for no behavioral gain — cleanup pass material, not bug-fix material (rule: no drive-by edits) |
| A13 | P3 | `ai-model-catalog.service.ts` | degenerate-catalog fallback: when no enabled economy model exists, `?? models[0]` can select a disabled/advanced model for a free user | edge case unreachable with the seeded catalog; needs a product decision (fail closed vs. any model) rather than a silent change |
| A14 | P3 | `src/main.ts`, `app.module.ts` | CORS wide open (`enableCors()` no args); no helmet; no rate limiting on auth-adjacent routes | all are known/documented current state (`CORS_ORIGIN` is dead config); tightening risks breaking the web client and needs new deps (rule 5) — see Security findings |
| A15 | P3 | `url-guard.service.ts` | SSRF residuals: TEST-NET/benchmark ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `198.18.0.0/15`) and IPv4-compatible IPv6 (`::a.b.c.d`) not blocked; resolve-then-fetch leaves a DNS-rebinding window (fetch re-resolves after the guard) | robust fix = pin the undici dispatcher with a custom lookup (connect-time IP check) — a structural change to the fetch path; recommend as a follow-up task |
| A16 | P3 | `gemini.strategy.ts` | `yield` inside `finally` of `generateStream` (anti-pattern: delays exception propagation; generator can stay suspended after consumer break) | no endpoint uses streaming today; rewrite when streaming ships |
| A17 | P3 | `AGENTS.md` | doc drift: claimed Nest 11 / openai 6 / TS 5.7 / `SUPABASE_URL` / broken `nest build` — all stale | fixed in this run's docs commit (the file itself instructs updating it when it conflicts with code) |

## Security findings

- **Hardcoded secrets: none found** in `src/` or `test/`. All keys flow from env
  (`SUPABASE_PROJECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`, provider keys); `.env`
  is gitignored and was never committed (verified `.gitignore` before `git init`).
- **No rotation needed as a result of this run.** Note for hygiene: the service-role
  key sits in a local `.env` with broad file permissions — tighten with
  `chmod 600 .env` if that matters in your environment.
- **IDOR: none.** The server is stateless; every DB access is scoped by the
  authenticated `user.id` from the guard (checked in `QuotaRepository`,
  `AiModelCatalogService`, `BillingService`); no by-id record fetching exists.
- **AI output never trusted** (zod + one repair retry via `AiJsonService`); client
  drafts re-validated server-side (`parseClientRecipeDraft` → 400); `modelId`
  re-checked against the catalog on every call.
- **SSRF posture** (`/recipes/import`): https-only, no URL credentials,
  DNS-resolved private/loopback/link-local/CGNAT/multicast rejection re-checked
  on every redirect hop, 3-redirect cap, 2 MB body cap, 10 s timeout. Residual
  gaps (A15) are narrow (non-routable doc ranges; DNS rebinding) — listed above.
- **Hardening recommendations (A14):** restrict CORS via `CORS_ORIGIN` (wire it
  into `enableCors`), add `helmet`, add rate limiting on `/ai/*` + `/billing/*`.
  All require either a product decision or new dependencies → not applied here.
- **Error hygiene:** provider/DB errors are mapped to `ApiException` messages;
  the filter never echoes stacks to clients (500 bodies carry only `message`).
  A5 additionally stops misconfigured Ollama traffic from leaking payloads to
  a third-party cloud endpoint.

## Optimizations — Inventory B

### Applied (Phase 3)

1. **`ai_models` catalog TTL cache** (`ai-model-catalog.service.ts`) — the
   ops-managed reference table was fetched from Supabase on every AI request
   (`resolveModel`) and every `GET /ai/models`. Now cached in-process for 30 s;
   failures and empty results are never cached (a transiently empty table can't
   pin "no models configured").
   *Measured (unit test asserts it):* 3 catalog reads within a TTL window →
   **1** `select()` call; post-TTL read refreshes and serves new data.
   *Per-request effect:* the reserve path drops from 3 serial Supabase
   round-trips (tier → models → plan) to 1 cached lookup + 1 parallel batch.
2. **Parallel independent reads in `QuotaService.reserve`** — after the tier is
   known, `resolveModel` and `getActivePlan` are independent and now run via
   `Promise.all`: one parallel batch instead of two serial round-trips per
   free-tier AI request. Verified by the full suite (ordering-insensitive
   assertions) plus the existing premium path (`getActivePlan` still untouched).

### Evaluated and intentionally skipped

| candidate | decision |
| --- | --- |
| DB indexes for the quota query | **already exist** (`ai_usage_log (user_id, created_at desc)` in the base schema) — no migration written |
| Pagination on list endpoints | no list endpoints exist (only `GET /ai/models`, bounded reference data) |
| Response compression | payloads are small JSON drafts; no measurable win |
| Keep-alive on outbound fetch | Node's undici already pools connections by default; recipe fetcher has explicit timeouts |
| Caching `profiles.subscription_tier` | deliberately **not** cached — tier must reflect upgrades immediately |
| Lazy modules / cold start | boot is fast (<2 s); nothing heavy imported eagerly |

## Tests — Inventory C

Strategy: extend the existing Vitest setup exactly as-is. **No test ever touched
real data** — unit specs mock the Supabase seam (`mockDeep`/hand chains), e2e
compiles the real `AppModule` against `createFakeSupabaseClient()` and mocked
AI SDKs; zero network. This satisfies the test-database rule (isolated fake —
no real Supabase project is reachable from the suite).

Added in this run (13 tests):

| file | covers |
| --- | --- |
| `quota.service.spec.ts` | A3 no-reservation-on-catalog-failure; A2 non-quota failure propagates; A1 premium non-chat cost 0 |
| `chat.service.spec.ts` | A4 `AI_DEFAULT_PROVIDER` honored; A8 release failure doesn't mask |
| `recipe-ai.service.spec.ts` | A8 release failure doesn't mask |
| `ollama.strategy.spec.ts` | A5 missing base URL fails fast, SDK untouched |
| `ai-model-catalog.service.spec.ts` | A6 getTier throws on DB error; cache round-trip count + TTL refresh; failures/empty never cached |
| `billing.service.spec.ts` | A7 DB failure surfaces, not 400 |
| `test/ai.e2e-spec.ts` | A1 premium generate `p_token_cost: 0` (wire-level); A2 `db down` → 500 not 429 (wire-level) |

A9 is proven by the suite itself booting with the corrected env var; A10 by
lint reporting zero warnings. Two pre-existing quota-spec cases were corrected
in the fix commit because they asserted the buggy A2 mapping verbatim.

Coverage baseline (unit): 24 files / 192 tests; e2e: 4 files / 53 tests — all
green in a single run, before and after optimization.

## Leftovers & recommendations

1. **A15 — close the SSRF residuals**: pin an undici dispatcher with a
   connect-time IP allowlist check (kills the DNS-rebinding window and covers
   the unblocked documentation/benchmark ranges in one place).
2. **A14 — hardening package**: CORS from `CORS_ORIGIN`, `helmet`, rate limits
   on AI/billing routes (needs `@nestjs/throttler` — new dependency).
3. **A11 — graceful shutdown**: `app.enableShutdownHooks()` once anything holds
   resources worth draining; add SIGTERM drain if deployed behind a rolling
   restart.
4. **A12 — dead code**: delete `QuotaRepository.getProfile`,
   `UrlGuardService.isHostSafe` (+ their spec blocks) in a cleanup PR.
5. **A13 — catalog fail-closed decision**: when no enabled economy model
   exists, decide whether free-tier requests should fail loudly rather than
   fall back to `models[0]`.
6. **A16 — streaming rewrite**: move the final chunk out of `finally` in
   `GeminiStrategy.generateStream` when a streaming endpoint ships.
7. **Janitor sweep**: the documented `ai_usage_log` sweeper (abandoned
   reservations) is a DB-side job — confirm it is actually scheduled in
   Supabase (cron/pg_cron); A3 reduced the leak rate but crashes can still
   strand rows.
8. **AGENTS.md** was refreshed in this run (versions, env var name, build
   status); re-verify after the next dependency bump.

## Verification (final gate, clean run)

| gate | result |
| --- | --- |
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ 0 warnings, 0 errors (baseline had 1 warning) |
| `rm -rf dist && npm run build` | ✅ compiles clean |
| Boot smoke (`node dist/main.js`, dummy Supabase env) | ✅ starts, DI resolves, guarded route answers 401 |
| `npm run test` | ✅ 192/192 (24 files) |
| `npm run test:e2e` | ✅ 53/53 (4 files) |

Contract check: every e2e spec asserts the documented wire shapes
(`../clients/web/docs/API_ENDPOINTS.md`); no route, status code, or response
field changed in this run except where the behavior itself was the bug
(non-quota outages now 500 instead of 429; premium non-chat actions no longer
fail on token balance — both restore the documented contract).
