import type { Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AiJsonService, type RecipeDraft } from '../../ai';
import type { IQuotaService, QuotaReservation } from '../../quota';
import type { GenerateRecipeDto } from '../dtos';
import { RecipeAiService } from './recipe-ai.service';

const DRAFT: RecipeDraft = {
  title: 'Tomato Rice',
  description: 'desc',
  cuisine: 'Italian',
  prepTimeMinutes: 20,
  cookTimeMinutes: null,
  servings: 2,
  difficulty: 'easy',
  image: null,
  ingredients: [{ name: 'rice', amount: 200, unit: 'g' }],
  steps: [{ instruction: 'Cook.' }],
  dietaryTags: [],
};

const RESERVATION: QuotaReservation = {
  usageId: 'usage-1',
  route: {
    id: '11111111-1111-4111-8111-111111111111',
    provider: 'gemini',
    providerModel: 'gemini-2.5-flash',
  },
  tier: 'free',
  action: 'generate_recipe',
};

const USAGE = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function baseParams(): GenerateRecipeDto {
  return {
    userId: 'u1',
    signal: new AbortController().signal,
    ingredients: ['tomatoes', 'rice'],
  };
}

describe('RecipeAiService', () => {
  let aiJson: { generateValidated: Mock };
  let quota: { reserve: Mock; complete: Mock; release: Mock };
  let service: RecipeAiService;

  beforeEach(() => {
    aiJson = {
      generateValidated: vi.fn().mockResolvedValue({
        data: DRAFT,
        usage: USAGE,
        model: 'gemini-2.5-flash',
      }),
    };
    quota = {
      reserve: vi.fn().mockResolvedValue(RESERVATION),
      complete: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };
    service = new RecipeAiService(
      aiJson as unknown as AiJsonService,
      quota as unknown as IQuotaService,
    );
  });

  describe('generateRecipe', () => {
    it('reserves quota, generates, then completes with the real token usage', async () => {
      const result = await service.generateRecipe(baseParams());

      expect(quota.reserve).toHaveBeenCalledWith({
        userId: 'u1',
        action: 'generate_recipe',
        modelId: undefined,
      });
      expect(quota.complete).toHaveBeenCalledWith({
        reservation: RESERVATION,
        model: 'gemini-2.5-flash',
        ...USAGE,
      });
      expect(result).toEqual({
        recipe: DRAFT,
        tokensUsed: 15,
        model: RESERVATION.route,
      });
    });

    it('builds the user prompt from the constraints that were provided', async () => {
      await service.generateRecipe({
        ...baseParams(),
        cuisine: 'Italian',
        maxCalories: 600,
        maxPrepMinutes: 45,
        dietaryTags: ['gluten-free'],
      });

      const { userPrompt } = aiJson.generateValidated.mock.calls[0][0];
      expect(userPrompt).toBe(
        [
          'Ingredients on hand: tomatoes, rice.',
          'Cuisine: Italian.',
          'Maximum calories per serving: 600 kcal.',
          'Maximum preparation time: 45 minutes.',
          'Dietary requirements: gluten-free.',
        ].join('\n'),
      );
    });

    it('routes through the reservation provider and model, clearing the "default" placeholder', async () => {
      const params = baseParams();
      quota.reserve.mockResolvedValue({
        ...RESERVATION,
        route: { ...RESERVATION.route, provider: 'default', providerModel: undefined },
      });

      await service.generateRecipe(params);

      const { options } = aiJson.generateValidated.mock.calls[0][0];
      expect(options.provider).toBeUndefined();
      expect(options.model).toBeUndefined();
      expect(options.userId).toBe('u1');
      expect(options.signal).toBe(params.signal);
      expect(options.requestId).toMatch(/^gen-recipe-u1-\d+$/);
    });

    it('keeps an explicit provider from the catalog route', async () => {
      await service.generateRecipe(baseParams());

      const { options } = aiJson.generateValidated.mock.calls[0][0];
      expect(options.provider).toBe('gemini');
      expect(options.model).toBe('gemini-2.5-flash');
    });

    it('releases the reservation and rethrows when generation fails', async () => {
      aiJson.generateValidated.mockRejectedValue(new Error('provider down'));

      await expect(service.generateRecipe(baseParams())).rejects.toThrow('provider down');

      expect(quota.complete).not.toHaveBeenCalled();
      expect(quota.release).toHaveBeenCalledWith(RESERVATION);
    });

    it('still throws the original generation error when releasing the reservation fails', async () => {
      aiJson.generateValidated.mockRejectedValue(new Error('provider down'));
      quota.release.mockRejectedValue(new Error('release failed'));

      await expect(service.generateRecipe(baseParams())).rejects.toThrow('provider down');
    });
  });

  describe('editRecipe', () => {
    it('sends the current draft and instruction, returning recipe + summary', async () => {
      aiJson.generateValidated.mockResolvedValue({
        data: { recipe: DRAFT, summary: 'Doubled the sauce.' },
        usage: USAGE,
        model: 'gemini-2.5-flash',
      });

      const result = await service.editRecipe({
        userId: 'u1',
        signal: new AbortController().signal,
        recipe: DRAFT,
        instruction: 'make it vegetarian and double the sauce',
      });

      const { userPrompt, jsonSchema, parse } = aiJson.generateValidated.mock.calls[0][0];
      expect(userPrompt).toContain('Requested change:');
      expect(userPrompt).toContain('make it vegetarian and double the sauce');
      expect(userPrompt).toContain('"title": "Tomato Rice"');
      expect(jsonSchema).toBeDefined();
      expect(typeof parse).toBe('function');

      expect(quota.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'edit_recipe' }),
      );
      expect(result).toEqual({
        recipe: DRAFT,
        summary: 'Doubled the sauce.',
        tokensUsed: 15,
        model: RESERVATION.route,
      });
    });

    it('rejects an invalid client draft with 400 before reserving any quota', async () => {
      await expect(
        service.editRecipe({
          userId: 'u1',
          signal: new AbortController().signal,
          recipe: { ingredients: 'nope' },
          instruction: 'x',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(quota.reserve).not.toHaveBeenCalled();
      expect(aiJson.generateValidated).not.toHaveBeenCalled();
    });
  });

  describe('analyzeNutrition', () => {
    it('returns the parsed analysis with token usage', async () => {
      const analysis = {
        caloriesPerServing: 540,
        proteinGrams: 32,
        carbsGrams: 48,
        fatGrams: 14,
        suggestions: ['Use Greek yogurt instead of cream.'],
      };
      aiJson.generateValidated.mockResolvedValue({
        data: analysis,
        usage: USAGE,
        model: 'gemini-2.5-flash',
      });

      const result = await service.analyzeNutrition({
        userId: 'u1',
        signal: new AbortController().signal,
        recipe: DRAFT,
      });

      expect(quota.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'nutrition_analysis' }),
      );
      expect(result).toEqual({
        analysis,
        tokensUsed: 15,
        model: RESERVATION.route,
      });
    });

    it('rejects an invalid client draft with 400 before reserving any quota', async () => {
      await expect(
        service.analyzeNutrition({
          userId: 'u1',
          signal: new AbortController().signal,
          recipe: null,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(quota.reserve).not.toHaveBeenCalled();
    });
  });
});
