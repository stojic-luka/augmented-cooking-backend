vi.mock('openai', () => ({ default: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
}));

import { installGeminiMock } from './helpers/ai-fixtures.js';
import { createTestApp, type TestApp } from './helpers/e2e-app.js';

describe('Orders and billing endpoints (e2e contract)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    installGeminiMock(); // strategies are constructed at boot; no calls expected
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    testApp.supabase.config.plan = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      is_active: true,
    };
  });

  describe('POST /orders', () => {
    it('places the order through the grocery partner and returns the receipt (201)', async () => {
      const res = await testApp
        .http()
        .post('/orders')
        .send({
          shoppingListId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          items: [{ name: 'rice', quantity: 2, unit: 'kg' }, { name: 'salt' }],
        });

      expect(res.status).toBe(201);
      expect(Object.keys(res.body).sort()).toEqual(['orderId', 'status']);
      expect(res.body.orderId).toEqual(expect.any(String));
      expect(res.body.status).toBe('placed');
    });

    it('rejects an empty item list with the documented message (400)', async () => {
      const res = await testApp.http().post('/orders').send({ items: [] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Add at least one item to order.');
    });

    it('rejects an item without a name (400)', async () => {
      const res = await testApp
        .http()
        .post('/orders')
        .send({ items: [{ quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('name must be a string');
    });

    it('rejects a non-UUID shoppingListId (400)', async () => {
      const res = await testApp
        .http()
        .post('/orders')
        .send({ shoppingListId: 'nope', items: [{ name: 'rice' }] });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('shoppingListId must be a valid UUIDv4.');
    });
  });

  describe('POST /billing/subscribe', () => {
    const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    it('records the intent and returns the documented pending body (202)', async () => {
      const res = await testApp
        .http()
        .post('/billing/subscribe')
        .send({ planId: PLAN_ID });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        status: 'pending',
        message:
          'Request recorded; payment flow will complete here once integrated.',
      });
    });

    it('rejects an unknown or inactive plan with 400', async () => {
      testApp.supabase.config.plan = null;

      const res = await testApp
        .http()
        .post('/billing/subscribe')
        .send({ planId: PLAN_ID });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        code: 'ERR',
        message: 'Unknown or inactive plan.',
      });
    });

    it('rejects a non-UUID planId (400)', async () => {
      const res = await testApp
        .http()
        .post('/billing/subscribe')
        .send({ planId: 'free-forever' });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('planId must be a valid UUIDv4.');
    });
  });

  describe('POST /billing/tokens', () => {
    it('records the top-up intent (202)', async () => {
      const res = await testApp
        .http()
        .post('/billing/tokens')
        .send({ tokens: 10_000 });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({
        status: 'pending',
        message:
          'Request recorded; payment flow will complete here once integrated.',
      });
    });

    it('enforces the documented minimum top-up (400)', async () => {
      const res = await testApp
        .http()
        .post('/billing/tokens')
        .send({ tokens: 999 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Minimum top-up is 1,000 tokens.');
    });

    it('rejects fractional token amounts (400)', async () => {
      const res = await testApp
        .http()
        .post('/billing/tokens')
        .send({ tokens: 100.5 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('tokens must be an integer');
    });
  });
});
