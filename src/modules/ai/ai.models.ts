import { z } from 'zod';

export const subscriptionTierSchema = z.enum(['free', 'premium']);
export type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;

/** Resolved route for an AI call: catalog row + provider/model to invoke. */
export interface AiModelRoute {
  id: string;
  provider: string;
  providerModel?: string;
}

/** Mirrors the `ai_action_type` DB enum. */
export const aiActionTypeSchema = z.enum([
  'generate_recipe',
  'edit_recipe',
  'nutrition_analysis',
  'substitute_ingredient',
  'recommend',
  'chat',
]);
export type AiActionType = z.infer<typeof aiActionTypeSchema>;

export const aiModelTierSchema = z.enum(['economy', 'advanced']);

/** Row of the `ai_models` reference table (enabled rows only, for callers). */
export const aiModelRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: aiModelTierSchema,
  is_enabled: z.boolean(),
  min_tier: subscriptionTierSchema,
  provider: z.string().nullable().catch(null),
  provider_model: z.string().nullable().catch(null),
});
export type AiModelRecord = z.infer<typeof aiModelRecordSchema>;

/** `GET /ai/models` response item. */
export const aiModelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: aiModelTierSchema,
  is_enabled: z.boolean(),
  min_tier: subscriptionTierSchema,
});
export type AiModelDto = z.infer<typeof aiModelDtoSchema>;

export const aiModelsResponseSchema = z.object({
  models: z.array(aiModelDtoSchema),
});
export type AiModelsResponse = z.infer<typeof aiModelsResponseSchema>;

/**
 * Input recipe draft for AI endpoints and the importer — normalized wire
 * shape agreed with the frontend (`AiRecipeDraft`).
 */
export const recipeIngredientSchema = z.object({
  name: z.string().min(1),
  amount: z.number().nullable().catch(null),
  unit: z.string().catch(''),
});

export const recipeDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().catch(''),
  cuisine: z.string().catch(''),
  prepTimeMinutes: z.coerce.number().int().positive().catch(30),
  cookTimeMinutes: z.number().int().positive().nullable(),
  servings: z.coerce.number().int().positive().catch(4),
  difficulty: z.string().nullable().catch(null),
  image: z.string().nullable().catch(null),
  // Arrays default only when the key is absent; present-but-malformed values
  // must fail validation (client drafts are rejected, AI output gets repaired).
  ingredients: z.array(recipeIngredientSchema).default([]),
  steps: z.array(z.object({ instruction: z.string().min(1) })).default([]),
  dietaryTags: z.array(z.string()).default([]),
});
export type RecipeDraft = z.infer<typeof recipeDraftSchema>;

/** `POST /ai/analyze-nutrition` response. */
export const nutritionAnalysisSchema = z.object({
  caloriesPerServing: z.number(),
  proteinGrams: z.number(),
  carbsGrams: z.number(),
  fatGrams: z.number(),
  suggestions: z.array(z.string()),
});
export type NutritionAnalysis = z.infer<typeof nutritionAnalysisSchema>;
