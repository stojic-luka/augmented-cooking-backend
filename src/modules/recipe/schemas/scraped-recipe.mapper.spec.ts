import { normalizeScrapedRecipe } from './scraped-recipe.mapper';

function scraped(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Slow Tomato Rice',
    description: 'A cozy one-pot rice.',
    cuisine: ['Italian'],
    prepTime: 10,
    cookTime: 20,
    totalTime: 30,
    yields: 'Serves 4',
    image: 'https://example.blog/rice.jpg',
    ingredients: [
      {
        name: 'Main',
        items: [
          {
            value: '200 g rice',
            parsed: { quantity: 200, unitOfMeasure: 'g', description: 'rice' },
          },
          { value: 'salt to taste', parsed: null },
        ],
      },
    ],
    instructions: [
      { name: 'Cook', items: [{ value: 'Boil the stock.' }, { value: 'Add rice.' }] },
      { name: 'Finish', items: ['Season with salt.'] },
    ],
    dietaryRestrictions: ['https://schema.org/vegandiet', 'https://schema.org/glutenfreediet'],
    ...overrides,
  };
}

describe('normalizeScrapedRecipe', () => {
  it('maps a full scraped recipe onto the draft wire shape', () => {
    const draft = normalizeScrapedRecipe(scraped());

    expect(draft).toMatchObject({
      title: 'Slow Tomato Rice',
      description: 'A cozy one-pot rice.',
      cuisine: 'Italian',
      prepTimeMinutes: 10,
      cookTimeMinutes: 20,
      servings: 4,
      difficulty: null,
      image: 'https://example.blog/rice.jpg',
      dietaryTags: ['vegan', 'gluten_free'],
    });
    expect(draft?.ingredients).toEqual([
      { name: 'rice', amount: 200, unit: 'g' },
      { name: 'salt to taste', amount: null, unit: '' },
    ]);
    expect(draft?.steps).toEqual([
      { instruction: 'Boil the stock.' },
      { instruction: 'Add rice.' },
      { instruction: 'Season with salt.' },
    ]);
  });

  it('returns null when the page lacks title, ingredients or steps', () => {
    expect(normalizeScrapedRecipe(scraped({ title: '' }))).toBeNull();
    expect(normalizeScrapedRecipe(scraped({ ingredients: [] }))).toBeNull();
    expect(normalizeScrapedRecipe(scraped({ instructions: [] }))).toBeNull();
  });

  it('drops empty step strings produced by scraper noise', () => {
    const draft = normalizeScrapedRecipe(
      scraped({
        instructions: [{ name: 'Cook', items: ['  ', { value: '' }, { value: 'Stir well.' }] }],
      }),
    );

    expect(draft?.steps).toEqual([{ instruction: 'Stir well.' }]);
  });

  describe('servings from the yield text', () => {
    it('reads the first number in common phrasings', () => {
      expect(normalizeScrapedRecipe(scraped({ yields: 'Makes 24 cookies' }))?.servings).toBe(24);
      expect(normalizeScrapedRecipe(scraped({ yields: '4 servings' }))?.servings).toBe(4);
    });

    it('falls back to 4 servings when the yield is missing or unparsable', () => {
      expect(normalizeScrapedRecipe(scraped({ yields: null }))?.servings).toBe(4);
      expect(normalizeScrapedRecipe(scraped({ yields: 'a bowl' }))?.servings).toBe(4);
      expect(normalizeScrapedRecipe(scraped({ yields: '0 servings' }))?.servings).toBe(4);
    });
  });

  describe('time fields', () => {
    it('falls back to totalTime for prep when prepTime is absent', () => {
      const draft = normalizeScrapedRecipe(scraped({ prepTime: null }));
      expect(draft?.prepTimeMinutes).toBe(30);
    });

    it('treats zero/negative or missing cook times as no cooking (null)', () => {
      expect(normalizeScrapedRecipe(scraped({ cookTime: 0 }))?.cookTimeMinutes).toBeNull();
      expect(normalizeScrapedRecipe(scraped({ cookTime: null }))?.cookTimeMinutes).toBeNull();
    });
  });

  describe('dietary restrictions', () => {
    it('maps known schema.org diet URLs and deduplicates the result', () => {
      const draft = normalizeScrapedRecipe(
        scraped({
          dietaryRestrictions: [
            'https://schema.org/VeganDiet',
            'https://schema.org/vegandiet',
            'https://schema.org/diabeticdiet',
            'https://schema.org/unknown',
          ],
        }),
      );

      expect(draft?.dietaryTags).toEqual(['vegan', 'sugar_free']);
    });

    it('ignores non-array restrictions', () => {
      expect(
        normalizeScrapedRecipe(scraped({ dietaryRestrictions: 'vegan' }))?.dietaryTags,
      ).toEqual([]);
    });
  });
});
