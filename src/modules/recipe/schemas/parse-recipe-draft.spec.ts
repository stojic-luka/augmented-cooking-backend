import {
  parseClientRecipeDraft,
  parseEditRecipeResponse,
  parseNutritionAnalysis,
  parseRecipeDraft,
} from './parse-recipe-draft';

const MINIMAL_DRAFT = { title: 'Tomato Rice', cookTimeMinutes: null };

describe('parseRecipeDraft (AI output normalizer)', () => {
  it('fills wire defaults for a minimal valid draft', () => {
    const draft = parseRecipeDraft(MINIMAL_DRAFT);

    expect(draft).toMatchObject({
      title: 'Tomato Rice',
      description: '',
      cuisine: '',
      prepTimeMinutes: 30,
      cookTimeMinutes: null,
      servings: 4,
      difficulty: null,
      image: null,
      ingredients: [],
      steps: [],
      dietaryTags: [],
    });
  });

  it('coerces the loose shapes providers actually emit', () => {
    const draft = parseRecipeDraft({
      title: '  Tomato Rice  ',
      prepTimeMinutes: '45',
      servings: '2',
      cookTimeMinutes: 0, // "no cooking" → null on the wire
      difficulty: 'EASY',
      ingredients: [
        { name: 'rice', amount: '200', unit: 'g' },
        { name: 'salt', amount: '', unit: '' }, // empty amount → null
        { name: 'pepper', amount: null, unit: 'pinch' },
        { name: 'onion', amount: 'not-a-number', unit: 'g' }, // → null
      ],
      steps: ['Boil water.', { instruction: 'Add rice.' }, 'Simmer.'],
    });

    expect(draft.title).toBe('Tomato Rice');
    expect(draft.prepTimeMinutes).toBe(45);
    expect(draft.servings).toBe(2);
    expect(draft.cookTimeMinutes).toBeNull();
    expect(draft.difficulty).toBe('easy');
    expect(draft.ingredients).toEqual([
      { name: 'rice', amount: 200, unit: 'g' },
      { name: 'salt', amount: null, unit: '' },
      { name: 'pepper', amount: null, unit: 'pinch' },
      { name: 'onion', amount: null, unit: 'g' },
    ]);
    expect(draft.steps).toEqual([
      { instruction: 'Boil water.' },
      { instruction: 'Add rice.' },
      { instruction: 'Simmer.' },
    ]);
  });

  it('maps unknown difficulties to null', () => {
    expect(parseRecipeDraft({ ...MINIMAL_DRAFT, difficulty: 'expert' }).difficulty).toBeNull();
  });

  it('rounds fractional prep/serving numbers', () => {
    const draft = parseRecipeDraft({ ...MINIMAL_DRAFT, prepTimeMinutes: 29.6, servings: 3.2 });
    expect(draft.prepTimeMinutes).toBe(30);
    expect(draft.servings).toBe(3);
  });

  it('throws one error listing every validation problem (for the AI repair prompt)', () => {
    expect(() => parseRecipeDraft({ title: '' })).toThrow(/^Invalid recipe draft: .*title/);
  });

  it('rejects a non-object payload', () => {
    expect(() => parseRecipeDraft('nope')).toThrow('Expected a JSON object.');
    expect(() => parseRecipeDraft([1, 2])).toThrow('Expected a JSON object.');
  });
});

describe('parseClientRecipeDraft (client input, strict)', () => {
  it('accepts a valid wire draft', () => {
    const draft = parseClientRecipeDraft({
      title: 'Soup',
      cookTimeMinutes: 10,
      ingredients: [{ name: 'water', amount: 500, unit: 'ml' }],
      steps: [{ instruction: 'Boil.' }],
    });

    expect(draft.cookTimeMinutes).toBe(10);
  });

  it('rejects drafts with an invalid cook time (not coerced for client input)', () => {
    expect(() => parseClientRecipeDraft({ title: 'Soup', cookTimeMinutes: '10' })).toThrow(
      /cookTimeMinutes/,
    );
  });

  it('rejects drafts without a title', () => {
    expect(() => parseClientRecipeDraft({ cookTimeMinutes: null })).toThrow(/title/);
  });

  it('rejects malformed ingredients/steps/dietaryTags instead of silently emptying them', () => {
    expect(() =>
      parseClientRecipeDraft({
        ...MINIMAL_DRAFT,
        ingredients: [{ name: '', amount: 1, unit: 'g' }],
      }),
    ).toThrow(/ingredients/);
    expect(() => parseClientRecipeDraft({ ...MINIMAL_DRAFT, ingredients: 'nope' })).toThrow(
      /ingredients/,
    );
    expect(() =>
      parseClientRecipeDraft({ ...MINIMAL_DRAFT, steps: [{ instruction: '' }] }),
    ).toThrow(/steps/);
    expect(() => parseClientRecipeDraft({ ...MINIMAL_DRAFT, dietaryTags: 'vegan' })).toThrow(
      /dietaryTags/,
    );
  });

  it('defaults omitted array fields to empty arrays', () => {
    const draft = parseClientRecipeDraft(MINIMAL_DRAFT);

    expect(draft.ingredients).toEqual([]);
    expect(draft.steps).toEqual([]);
    expect(draft.dietaryTags).toEqual([]);
  });
});

describe('parseNutritionAnalysis', () => {
  it('parses macros and coerces loose numbers', () => {
    const analysis = parseNutritionAnalysis({
      caloriesPerServing: '540',
      proteinGrams: '32',
      carbsGrams: 48,
      fatGrams: 14,
      suggestions: ['Use Greek yogurt instead of cream.'],
    });

    expect(analysis).toEqual({
      caloriesPerServing: 540,
      proteinGrams: 32,
      carbsGrams: 48,
      fatGrams: 14,
      suggestions: ['Use Greek yogurt instead of cream.'],
    });
  });

  it('defaults suggestions to an empty array when the model omits them', () => {
    const analysis = parseNutritionAnalysis({
      caloriesPerServing: 300,
      proteinGrams: 10,
      carbsGrams: 40,
      fatGrams: 5,
    });

    expect(analysis.suggestions).toEqual([]);
  });

  it('requires calories > 0 and non-negative macros', () => {
    const base = { proteinGrams: 1, carbsGrams: 1, fatGrams: 1, suggestions: [] };
    expect(() => parseNutritionAnalysis({ ...base, caloriesPerServing: 0 })).toThrow(
      /caloriesPerServing must be > 0/,
    );
    expect(() =>
      parseNutritionAnalysis({ ...base, caloriesPerServing: 100, proteinGrams: -1 }),
    ).toThrow(/proteinGrams must be >= 0/);
  });
});

describe('parseEditRecipeResponse', () => {
  const validDraft = { ...MINIMAL_DRAFT };

  it('returns the trimmed summary plus the parsed recipe', () => {
    const result = parseEditRecipeResponse({
      recipe: validDraft,
      summary: '  Doubled the sauce.  ',
    });

    expect(result.summary).toBe('Doubled the sauce.');
    expect(result.recipe.title).toBe('Tomato Rice');
  });

  it('requires a non-empty summary describing the change', () => {
    expect(() => parseEditRecipeResponse({ recipe: validDraft })).toThrow(
      'Missing "summary" describing the applied changes.',
    );
    expect(() => parseEditRecipeResponse({ recipe: validDraft, summary: '   ' })).toThrow(
      'Missing "summary" describing the applied changes.',
    );
  });

  it('validates the embedded recipe against the draft schema', () => {
    expect(() => parseEditRecipeResponse({ recipe: {}, summary: 'x' })).toThrow(
      /Invalid recipe draft/,
    );
  });
});
