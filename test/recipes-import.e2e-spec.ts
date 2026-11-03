vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('@lib/recipe-scrapers', () => ({ loadRecipeScrapers: vi.fn() }));

import type { Mock } from 'vitest';
import { lookup } from 'node:dns/promises';
import { loadRecipeScrapers } from '../src/lib/recipe-scrapers';
import { createTestApp, type TestApp } from './helpers/e2e-app.js';

const mockLookup = lookup as unknown as Mock;
const mockLoadScrapers = loadRecipeScrapers as unknown as Mock;

const SCRAPED_DRAFT = {
  title: 'Classic Pancakes',
  description: 'Fluffy weekend pancakes.',
  cuisine: '',
  prepTimeMinutes: 10,
  cookTimeMinutes: 15,
  servings: 4,
  difficulty: null,
  image: null,
  ingredients: [{ name: 'flour', amount: 200, unit: 'g' }],
  steps: [
    { instruction: 'Whisk the batter.' },
    { instruction: 'Fry until golden.' },
  ],
  dietaryTags: ['vegetarian'],
};

describe('POST /recipes/import (e2e contract)', () => {
  let testApp: TestApp;
  let fetchMock: Mock;
  let scrapeRecipe: Mock;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    testApp = await createTestApp();
    scrapeRecipe = vi.fn();
    mockLoadScrapers.mockResolvedValue({ scrapeRecipe });
  });

  afterAll(async () => {
    await testApp.close();
  });

  beforeEach(() => {
    mockLookup
      .mockReset()
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    scrapeRecipe.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function htmlPage(body: string) {
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  it('scrapes a public https page into the documented draft response (201)', async () => {
    fetchMock.mockResolvedValue(htmlPage('<html>recipe page</html>'));
    scrapeRecipe.mockResolvedValue({
      success: true,
      data: {
        title: 'Classic Pancakes',
        description: 'Fluffy weekend pancakes.',
        prepTime: 10,
        cookTime: 15,
        yields: 'Serves 4',
        ingredients: [
          {
            name: 'Batter',
            items: [
              {
                value: '200 g flour',
                parsed: {
                  quantity: 200,
                  unitOfMeasure: 'g',
                  description: 'flour',
                },
              },
            ],
          },
        ],
        instructions: [
          {
            name: 'Cook',
            items: [
              { value: 'Whisk the batter.' },
              { value: 'Fry until golden.' },
            ],
          },
        ],
        dietaryRestrictions: ['https://schema.org/vegetariandiet'],
      },
    });

    const res = await testApp
      .http()
      .post('/recipes/import')
      .send({ url: 'https://example.blog/pancakes' });

    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['recipe']);
    expect(res.body.recipe).toEqual(SCRAPED_DRAFT);
  });

  it('maps an unparsable page to 502 RECIPE_IMPORT_FAILED', async () => {
    fetchMock.mockResolvedValue(htmlPage('<html>not a recipe</html>'));
    scrapeRecipe.mockResolvedValue({ success: false, data: null });

    const res = await testApp
      .http()
      .post('/recipes/import')
      .send({ url: 'https://example.blog/whatever' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('RECIPE_IMPORT_FAILED');
  });

  it('maps a fetch failure to 502 RECIPE_IMPORT_FAILED', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const res = await testApp
      .http()
      .post('/recipes/import')
      .send({ url: 'https://unreachable.blog/recipe' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('RECIPE_IMPORT_FAILED');
  });

  it('rejects a URL that resolves to a private address with 400 INVALID_RECIPE_URL (SSRF guard)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    const res = await testApp
      .http()
      .post('/recipes/import')
      .send({ url: 'https://internal.service/recipe' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'INVALID_RECIPE_URL',
      message: 'This URL points to a non-public address.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'url must be a valid https:// URL.'],
    [{ url: 'not-a-url' }, 'url must be a valid https:// URL.'],
    [
      { url: 'http://example.blog/recipe' },
      'url must be a valid https:// URL.',
    ],
  ])(
    'rejects malformed URLs with the flat error body: %j',
    async (body, expectedMessage) => {
      const res = await testApp.http().post('/recipes/import').send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain(expectedMessage);
    },
  );
});
