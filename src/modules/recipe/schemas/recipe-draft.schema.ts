/**
 * JSON schema describing the recipe-draft object providers must return.
 * Nullable fields use `type` arrays; every property is required so the
 * schema also satisfies OpenAI structured-output strict mode.
 */
export const RECIPE_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  title: 'RECIPE_DRAFT',
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Name of the dish.' },
    description: { type: 'string', description: 'Short appetizing summary.' },
    cuisine: {
      type: 'string',
      description: 'Cuisine name, e.g. "Italian". Empty string when not applicable.',
    },
    prepTimeMinutes: { type: 'integer', description: 'Active preparation time in minutes (>= 1).' },
    cookTimeMinutes: {
      type: ['integer', 'null'],
      description: 'Cooking time in minutes (>= 1); null when no heat/appliance time is needed.',
    },
    servings: { type: 'integer', description: 'Number of servings (>= 1).' },
    difficulty: {
      type: ['string', 'null'],
      enum: ['easy', 'medium', 'hard', null],
      description: 'Overall difficulty.',
    },
    image: { type: ['string', 'null'], description: 'Optional image URL; null for AI drafts.' },
    ingredients: {
      type: 'array',
      description: 'All ingredients required for the dish.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Ingredient name, lowercase singular, e.g. "olive oil".',
          },
          amount: {
            type: ['number', 'null'],
            description: 'Numeric quantity, e.g. 200; null for "to taste".',
          },
          unit: {
            type: 'string',
            description:
              'Short unit code such as g, kg, ml, tbsp, piece. Empty string when count-less.',
          },
        },
        required: ['name', 'amount', 'unit'],
        additionalProperties: false,
      },
    },
    steps: {
      type: 'array',
      description: 'Chronological preparation steps.',
      items: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'One imperative step.' },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
    },
    dietaryTags: {
      type: 'array',
      description:
        'Dietary tags from: vegetarian, vegan, pescatarian, gluten_free, dairy_free, nut_free, egg_free, halal, kosher, low_carb, keto, paleo, sugar_free, other.',
      items: { type: 'string' },
    },
  },
  required: [
    'title',
    'description',
    'cuisine',
    'prepTimeMinutes',
    'cookTimeMinutes',
    'servings',
    'difficulty',
    'image',
    'ingredients',
    'steps',
    'dietaryTags',
  ],
  additionalProperties: false,
};

/** JSON schema for the nutrition-analysis response. */
export const NUTRITION_ANALYSIS_JSON_SCHEMA: Record<string, unknown> = {
  title: 'NUTRITION_ANALYSIS',
  type: 'object',
  properties: {
    caloriesPerServing: { type: 'number', description: 'Estimated kcal per serving (>= 0).' },
    proteinGrams: { type: 'number', description: 'Estimated grams of protein per serving (>= 0).' },
    carbsGrams: {
      type: 'number',
      description: 'Estimated grams of carbohydrates per serving (>= 0).',
    },
    fatGrams: { type: 'number', description: 'Estimated grams of fat per serving (>= 0).' },
    suggestions: {
      type: 'array',
      description: 'Concrete, actionable suggestions to make the recipe healthier.',
      items: { type: 'string' },
    },
  },
  required: ['caloriesPerServing', 'proteinGrams', 'carbsGrams', 'fatGrams', 'suggestions'],
  additionalProperties: false,
};

/** JSON schema for the edit-recipe response (edited draft + change summary). */
export const EDIT_RECIPE_RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  title: 'EDIT_RECIPE_RESPONSE',
  type: 'object',
  properties: {
    recipe: RECIPE_DRAFT_JSON_SCHEMA,
    summary: {
      type: 'string',
      description: 'One or two sentences describing the applied changes.',
    },
  },
  required: ['recipe', 'summary'],
  additionalProperties: false,
};
