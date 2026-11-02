vi.mock('openai', () => ({ default: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

import type { Mock } from 'vitest';
import type { AuthUser } from '@supabase/supabase-js';
import type { AddressInfo } from 'node:net';
import * as http from 'node:http';
import {
  ADVANCED_MODEL_ID,
  ECONOMY_MODEL_ID,
  rpcError,
} from './helpers/fake-supabase.client.js';
import {
  AI_NUTRITION_ANALYSIS,
  AI_RECIPE_DRAFT,
  PREMIUM_USER,
  geminiText,
  installGeminiMock,
} from './helpers/ai-fixtures.js';
import { createTestApp, type TestApp } from './helpers/e2e-app.js';
import { setTestUser } from './helpers/test-auth.guard.js';

describe('AI endpoints (e2e contract, docs/API_ENDPOINTS.md)', () => {
  let testApp: TestApp;
  let generateContent: Mock;
  let generateContentStream: Mock;

  beforeAll(async () => {
    const gemini = installGeminiMock();
    generateContent = gemini.generateContent;
    generateContentStream = gemini.generateContentStream;
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    // Reset the shared fake between tests: free profile, healthy plan, all
    // RPCs succeed. Individual tests override only what they exercise.
    Object.assign(testApp.supabase.config, {
      profile: { subscription_tier: 'free', tokens_remaining: 0 },
      reserveRpc: { data: 'usage-e2e-1', error: null },
      completeRpc: { data: 970, error: null },
    });
    testApp.supabase.calls.reserveRpc.length = 0;
    testApp.supabase.calls.completeRpc.length = 0;
    testApp.supabase.calls.releases.length = 0;
    generateContent.mockReset();
    setTestUser({
      id: '11111111-1111-4111-8111-111111111111',
    } as Partial<AuthUser>);
  });

  describe('POST /ai/generate-recipe', () => {
    const validBody = {
      ingredients: ['tomatoes', 'rice', 'chicken'],
      cuisine: 'Italian',
      maxCalories: 600,
      maxPrepMinutes: 45,
      dietaryTags: ['gluten-free'],
    };

    it('returns the documented draft shape with token usage (201)', async () => {
      generateContent.mockResolvedValue(
        geminiText(JSON.stringify(AI_RECIPE_DRAFT)),
      );

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['recipe', 'tokensUsed']);
      expect(res.body.recipe).toEqual(AI_RECIPE_DRAFT);
      expect(res.body.tokensUsed).toBe(120);
    });

    it('runs the quota lifecycle against the DB RPCs: reserve with the plan cap, complete token-free for free tier', async () => {
      generateContent.mockResolvedValue(
        geminiText(JSON.stringify(AI_RECIPE_DRAFT)),
      );

      await testApp.http().post('/ai/generate-recipe').send(validBody);

      expect(testApp.supabase.calls.reserveRpc).toEqual([
        {
          p_user_id: '11111111-1111-4111-8111-111111111111',
          p_action: 'generate_recipe',
          p_daily_cap: 30,
        },
      ]);
      expect(testApp.supabase.calls.completeRpc).toEqual([
        {
          p_usage_id: 'usage-e2e-1',
          p_model_id: ECONOMY_MODEL_ID,
          p_prompt_tokens: 100,
          p_completion_tokens: 20,
          p_token_cost: 0,
        },
      ]);
    });

    it('rejects a missing ingredients array with the flat error body (400)', async () => {
      const res = await testApp.http().post('/ai/generate-recipe').send({});

      expect(res.status).toBe(400);
      expect(Object.keys(res.body).sort()).toEqual(['code', 'message']);
      expect(res.body.message).toContain('ingredients must be an array');
    });

    it('rejects an empty ingredients list with the documented message (400)', async () => {
      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send({ ingredients: [] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Add at least one ingredient you have.');
    });

    it('rejects a non-UUID modelId (400)', async () => {
      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send({ ingredients: ['rice'], modelId: 'not-a-uuid' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('modelId must be a valid UUIDv4.');
    });

    it('returns 429 QUOTA_EXCEEDED when the daily cap RPC refuses the reservation', async () => {
      testApp.supabase.config.reserveRpc = {
        data: null,
        error: rpcError('P0001', 'DAILY_CAP_REACHED'),
      };

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        code: 'QUOTA_EXCEEDED',
        message:
          'Daily AI action limit reached. Upgrade to premium for unlimited AI actions.',
      });
      expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
    });

    it('returns 500 (not 429) when the reserve RPC fails for a non-quota reason', async () => {
      testApp.supabase.config.reserveRpc = {
        data: null,
        error: rpcError('XX000', 'db down'),
      };

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ code: 'ERR', message: 'db down' });
      expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
    });

    it('does not debit tokens for premium recipe generation (only /ai/chat is metered)', async () => {
      setTestUser(PREMIUM_USER);
      testApp.supabase.config.profile = {
        subscription_tier: 'premium',
        tokens_remaining: 1000,
      };
      generateContent.mockResolvedValue(geminiText(JSON.stringify(AI_RECIPE_DRAFT)));

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(testApp.supabase.calls.reserveRpc[0].p_daily_cap).toBeNull();
      expect(testApp.supabase.calls.completeRpc[0]).toMatchObject({
        p_token_cost: 0,
        p_prompt_tokens: 100,
        p_completion_tokens: 20,
      });
    });

    it('releases the reservation and returns 502 AI_UNAVAILABLE when the provider fails', async () => {
      generateContent.mockRejectedValue(new Error('quota exhausted'));

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('AI_UNAVAILABLE');
      expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
      expect(testApp.supabase.calls.releases).toEqual(['usage-e2e-1']);
    });

    it('returns 502 AI_RESPONSE_INVALID when the provider output stays unparsable after the repair retry', async () => {
      generateContent
        .mockResolvedValueOnce(geminiText('this is not json'))
        .mockResolvedValueOnce(geminiText('still not json'));

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('AI_RESPONSE_INVALID');
      expect(generateContent).toHaveBeenCalledTimes(2);
      expect(testApp.supabase.calls.releases).toEqual(['usage-e2e-1']);
    });

    it('accepts a fenced-JSON provider output through the repair-tolerant parser', async () => {
      generateContent.mockResolvedValue(
        geminiText('```json\n' + JSON.stringify(AI_RECIPE_DRAFT) + '\n```'),
      );

      const res = await testApp
        .http()
        .post('/ai/generate-recipe')
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.recipe).toEqual(AI_RECIPE_DRAFT);
    });
  });

  describe('POST /ai/edit-recipe', () => {
    const validBody = {
      recipe: AI_RECIPE_DRAFT,
      instruction: 'make it vegetarian and double the sauce',
    };

    it('returns the edited draft, a summary and token usage (200)', async () => {
      generateContent.mockResolvedValue(
        geminiText(
          JSON.stringify({
            recipe: AI_RECIPE_DRAFT,
            summary: 'Made it vegetarian.',
          }),
        ),
      );

      const res = await testApp.http().post('/ai/edit-recipe').send(validBody);

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'recipe',
        'summary',
        'tokensUsed',
      ]);
      expect(res.body.recipe).toEqual(AI_RECIPE_DRAFT);
      expect(res.body.summary).toBe('Made it vegetarian.');
      expect(res.body.tokensUsed).toBe(120);
    });

    it('rejects a structurally invalid recipe payload (400)', async () => {
      const res = await testApp
        .http()
        .post('/ai/edit-recipe')
        .send({ recipe: { title: 42 }, instruction: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('recipe');
    });

    it('rejects an empty instruction (400)', async () => {
      const res = await testApp
        .http()
        .post('/ai/edit-recipe')
        .send({ recipe: AI_RECIPE_DRAFT, instruction: '' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Describe the change you want.');
    });
  });

  describe('POST /ai/analyze-nutrition', () => {
    it('returns the flat analysis payload exactly as documented (200)', async () => {
      generateContent.mockResolvedValue(
        geminiText(JSON.stringify(AI_NUTRITION_ANALYSIS)),
      );

      const res = await testApp
        .http()
        .post('/ai/analyze-nutrition')
        .send({ recipe: AI_RECIPE_DRAFT });

      expect(res.status).toBe(200);
      // Flat response — no envelope, no wrapper object.
      expect(res.body).toEqual(AI_NUTRITION_ANALYSIS);
      expect(Object.keys(res.body).sort()).toEqual([
        'caloriesPerServing',
        'carbsGrams',
        'fatGrams',
        'proteinGrams',
        'suggestions',
      ]);
    });

    it('rejects a missing recipe (400)', async () => {
      const res = await testApp.http().post('/ai/analyze-nutrition').send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('recipe must be an object');
    });
  });

  describe('POST /ai/chat', () => {
    const validBody = {
      sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      messages: [
        { role: 'user', content: 'How do I keep pasta from sticking?' },
      ],
    };

    it('returns the documented shape with the contract fields plus legacy reply/tokensUsed (200)', async () => {
      generateContent.mockResolvedValue(
        geminiText('Stir during the first two minutes.'),
      );

      const res = await testApp.http().post('/ai/chat').send(validBody);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        text: 'Stir during the first two minutes.',
        modelId: ECONOMY_MODEL_ID,
        reply: 'Stir during the first two minutes.',
        tokensUsed: 120,
      });
    });

    it('debits premium chat tokens from the balance (token cost = tokens used)', async () => {
      setTestUser(PREMIUM_USER);
      testApp.supabase.config.profile = {
        subscription_tier: 'premium',
        tokens_remaining: 1000,
      };
      generateContent.mockResolvedValue(geminiText('Mise en place!'));

      const res = await testApp.http().post('/ai/chat').send(validBody);

      expect(res.status).toBe(200);
      expect(testApp.supabase.calls.reserveRpc[0].p_daily_cap).toBeNull();
      expect(testApp.supabase.calls.completeRpc[0]).toMatchObject({
        p_token_cost: 120,
        p_prompt_tokens: 100,
        p_completion_tokens: 20,
      });
    });

    it('returns 429 QUOTA_EXCEEDED when the premium token balance cannot cover the reply', async () => {
      setTestUser(PREMIUM_USER);
      testApp.supabase.config.profile = {
        subscription_tier: 'premium',
        tokens_remaining: 5,
      };
      testApp.supabase.config.completeRpc = {
        data: null,
        error: rpcError('P0001', 'INSUFFICIENT_TOKENS: balance 5 < cost 120'),
      };
      generateContent.mockResolvedValue(geminiText('Long answer'));

      const res = await testApp.http().post('/ai/chat').send(validBody);

      expect(res.status).toBe(429);
      expect(res.body).toEqual({
        code: 'QUOTA_EXCEEDED',
        message:
          'Not enough chat tokens remaining. Purchase a top-up to continue.',
      });
      expect(testApp.supabase.calls.releases).toEqual(['usage-e2e-1']);
    });

    it.each([
      [
        { messages: [{ role: 'user', content: 'hi' }] },
        'sessionId must be a valid UUIDv4.',
      ],
      [
        { sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', messages: [] },
        'messages must contain at least 1 elements',
      ],
      [
        {
          sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          messages: [{ role: 'system', content: 'hi' }],
        },
        'role must be "user" or "assistant".',
      ],
    ])(
      'rejects malformed payloads with the flat error body: %j',
      async (body, expectedMessage) => {
        const res = await testApp.http().post('/ai/chat').send(body);

        expect(res.status).toBe(400);
        expect(res.body.message).toContain(expectedMessage);
      },
    );

    it('maps a provider failure to 502 AI_UNAVAILABLE and releases the reservation', async () => {
      generateContent.mockRejectedValue(new Error('down'));

      const res = await testApp.http().post('/ai/chat').send(validBody);

      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        code: 'AI_UNAVAILABLE',
        message: 'Gemini Generation Failed: down',
      });
      expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
      expect(testApp.supabase.calls.releases).toEqual(['usage-e2e-1']);
    });
  });

  describe('POST /ai/chat/stream', () => {
    const validBody = {
      sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      messages: [
        { role: 'user', content: 'How do I keep pasta from sticking?' },
      ],
    };

    /** Frames are `data: {json}` blocks separated by a blank line. */
    function parseSseFrames(raw: string): Array<Record<string, unknown>> {
      return raw
        .split('\n\n')
        .filter((block) => block.trim() !== '')
        .map((block) => {
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice('data:'.length).trim())
            .join('');
          return JSON.parse(data) as Record<string, unknown>;
        });
    }

    /**
     * Streams `parts` with pauses, honoring the abort signal the way the real
     * SDK does, so disconnects surface as a mid-stream failure.
     */
    function mockGeminiStream(parts: string[], msBetweenParts = 25): void {
      generateContentStream.mockImplementation(async (parameters: {
        config?: { abortSignal?: AbortSignal };
      }) => {
        const signal = parameters.config?.abortSignal;
        return (async function* () {
          for (const part of parts) {
            if (signal?.aborted) {
              throw new Error('This operation was aborted');
            }
            yield { text: part };
            await new Promise((resolve) => setTimeout(resolve, msBetweenParts));
          }
        })();
      });
    }

    beforeEach(() => {
      generateContentStream.mockReset();
    });

    it('streams meta → delta* → done with the documented SSE headers (200)', async () => {
      mockGeminiStream(['Stir ', 'during ', 'the first two minutes.']);

      const res = await testApp.http().post('/ai/chat/stream').send(validBody);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.headers['x-accel-buffering']).toBe('no');

      const frames = parseSseFrames(res.text);
      expect(frames[0]).toEqual({ type: 'meta', modelId: ECONOMY_MODEL_ID });
      expect(frames.at(-1)).toEqual({
        type: 'done',
        text: 'Stir during the first two minutes.',
        modelId: ECONOMY_MODEL_ID,
      });
      const deltas = frames.slice(1, -1);
      expect(deltas).toEqual([
        { type: 'delta', text: 'Stir ' },
        { type: 'delta', text: 'during ' },
        { type: 'delta', text: 'the first two minutes.' },
      ]);
      expect(deltas.map((f) => f.text).join('')).toBe(
        (frames.at(-1) as { text: string }).text,
      );
      expect(testApp.supabase.calls.completeRpc).toHaveLength(1);
      expect(testApp.supabase.calls.completeRpc[0]).toMatchObject({
        p_usage_id: 'usage-e2e-1',
        p_model_id: ECONOMY_MODEL_ID,
        p_token_cost: 0, // free tier is never token-metered
      });
      expect(testApp.supabase.calls.completeRpc[0].p_completion_tokens).toBeGreaterThan(0);
      expect(testApp.supabase.calls.releases).toEqual([]);
    });

    it('rejects malformed payloads with the flat JSON error body, not an SSE stream (400)', async () => {
      const res = await testApp
        .http()
        .post('/ai/chat/stream')
        .send({ sessionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', messages: [] });

      expect(res.status).toBe(400);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body.message).toContain('messages must contain at least 1 elements');
      expect(testApp.supabase.calls.reserveRpc).toHaveLength(0);
    });

    it('returns 429 QUOTA_EXCEEDED as JSON when the reservation is refused before the stream starts', async () => {
      testApp.supabase.config.reserveRpc = {
        data: null,
        error: rpcError('P0001', 'DAILY_CAP_REACHED'),
      };

      const res = await testApp.http().post('/ai/chat/stream').send(validBody);

      expect(res.status).toBe(429);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).toEqual({
        code: 'QUOTA_EXCEEDED',
        message:
          'Daily AI action limit reached. Upgrade to premium for unlimited AI actions.',
      });
      expect(res.text).not.toContain('data:');
      expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
    });

    it('sends an error frame instead of done and releases the reservation when the provider fails mid-stream', async () => {
      generateContentStream.mockRejectedValue(new Error('down'));

      const res = await testApp.http().post('/ai/chat/stream').send(validBody);

      expect(res.status).toBe(200);
      const frames = parseSseFrames(res.text);
      expect(frames[0]).toEqual({ type: 'meta', modelId: ECONOMY_MODEL_ID });
      expect(frames.at(-1)).toEqual({
        type: 'error',
        message: 'Gemini Streaming Failed: down',
      });
      expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
      expect(testApp.supabase.calls.releases).toEqual(['usage-e2e-1']);
    });

    it('debits estimated tokens for premium streaming chat', async () => {
      setTestUser(PREMIUM_USER);
      testApp.supabase.config.profile = {
        subscription_tier: 'premium',
        tokens_remaining: 1000,
      };
      mockGeminiStream(['Mise ', 'en place!']);

      const res = await testApp.http().post('/ai/chat/stream').send(validBody);

      expect(res.status).toBe(200);
      expect(testApp.supabase.calls.reserveRpc[0].p_daily_cap).toBeNull();
      expect(testApp.supabase.calls.completeRpc[0]).toMatchObject({
        p_usage_id: 'usage-e2e-1',
        p_model_id: ECONOMY_MODEL_ID,
      });
      expect(testApp.supabase.calls.completeRpc[0].p_token_cost).toBeGreaterThan(0);
    });

    it('cancels the generation and releases the reservation when the client disconnects mid-stream', async () => {
      mockGeminiStream(['Stir ', 'during ', 'the first ', 'two minutes.']);

      const server = testApp.app.getHttpServer() as http.Server;
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;

      try {
        const request = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/ai/chat/stream',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
          },
          (response) => {
            response.on('data', () => {
              // Frames already flow while the generator is mid-flight —
              // dropping the connection now must stop the generation.
              request.destroy();
            });
          },
        );
        // Expected: we deliberately tear the connection down mid-stream.
        request.on('error', () => {});
        request.end(JSON.stringify(validBody));

        await vi.waitFor(
          () => {
            expect(testApp.supabase.calls.releases).toEqual(['usage-e2e-1']);
          },
          { timeout: 3000, interval: 25 },
        );
        expect(testApp.supabase.calls.completeRpc).toHaveLength(0);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('GET /ai/models', () => {
    it('lists only enabled economy models for the free tier, in the documented shape', async () => {
      const res = await testApp.http().get('/ai/models');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        models: [
          {
            id: ECONOMY_MODEL_ID,
            name: 'Flash',
            tier: 'economy',
            is_enabled: true,
            min_tier: 'free',
          },
        ],
      });
    });

    it('lists both tiers for a premium user', async () => {
      setTestUser(PREMIUM_USER);
      testApp.supabase.config.profile = {
        subscription_tier: 'premium',
        tokens_remaining: 1000,
      };

      const res = await testApp.http().get('/ai/models');

      expect(res.status).toBe(200);
      expect(res.body.models.map((m: { id: string }) => m.id)).toEqual([
        ECONOMY_MODEL_ID,
        ADVANCED_MODEL_ID,
      ]);
    });
  });
});
