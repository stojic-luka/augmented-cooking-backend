vi.mock('openai', () => ({ default: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

import type { AuthUser } from '@supabase/supabase-js';
import { installGeminiMock } from './helpers/ai-fixtures.js';
import { createRealGuardApp, type TestApp } from './helpers/e2e-app.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function authUser(): AuthUser {
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'user@test.local',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  } as unknown as AuthUser;
}

/**
 * Failure modes of the REAL SupabaseAuthGuard: the token is validated against
 * the (faked) Supabase auth server, and no user is stamped on failure.
 */
describe('SupabaseAuthGuard (e2e, real guard + mocked Supabase auth)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    installGeminiMock();
    testApp = await createRealGuardApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.supabase.config.authUser = authUser();
    testApp.supabase.config.authError = null;
    testApp.supabase.calls.getUserTokens.length = 0;
  });

  it('rejects a request without an Authorization header with 401 and the flat body', async () => {
    const res = await testApp.http().get('/ai/models');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    });
    expect(testApp.supabase.calls.getUserTokens).toHaveLength(0);
  });

  it('rejects a non-Bearer authorization scheme', async () => {
    const res = await testApp
      .http()
      .get('/ai/models')
      .set('Authorization', 'Basic dXNlcjpwYXNz');

    expect(res.status).toBe(401);
    expect(testApp.supabase.calls.getUserTokens).toHaveLength(0);
  });

  it('rejects an empty bearer token', async () => {
    const res = await testApp
      .http()
      .get('/ai/models')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
    expect(testApp.supabase.calls.getUserTokens).toHaveLength(0);
  });

  it('rejects a token the Supabase auth server refuses (error path)', async () => {
    testApp.supabase.config.authError = { message: 'Invalid JWT' };

    const res = await testApp
      .http()
      .get('/ai/models')
      .set('Authorization', 'Bearer expired-token');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_ACCESS_TOKEN');
  });

  it('rejects a token that validates but resolves to no user', async () => {
    testApp.supabase.config.authUser = null;

    const res = await testApp
      .http()
      .get('/ai/models')
      .set('Authorization', 'Bearer ghost-token');

    expect(res.status).toBe(401);
  });

  it('forwards the bearer token to Supabase and serves the endpoint for a valid user', async () => {
    const res = await testApp
      .http()
      .get('/ai/models')
      .set('Authorization', 'Bearer valid-supabase-token');

    expect(res.status).toBe(200);
    expect(testApp.supabase.calls.getUserTokens).toEqual([
      'valid-supabase-token',
    ]);
    expect(res.body).toEqual({
      models: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Flash',
          tier: 'economy',
          is_enabled: true,
          min_tier: 'free',
        },
      ],
    });
  });

  it.each([
    ['POST', '/ai/chat'],
    ['POST', '/recipes/import'],
    ['POST', '/orders'],
    ['POST', '/billing/subscribe'],
    ['POST', '/billing/tokens'],
  ])('guards %s %s the same way', async (method, path) => {
    const res = await testApp
      .http()
      [method.toLowerCase() as 'post'](path)
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_ACCESS_TOKEN');
  });
});
