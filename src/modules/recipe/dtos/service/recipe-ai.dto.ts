import type { AiModelRoute, NutritionAnalysis, RecipeDraft } from '@modules/ai';

export interface GenerateRecipeDto {
  userId: string;
  signal: AbortSignal;
  ingredients: string[];
  cuisine?: string;
  maxCalories?: number;
  maxPrepMinutes?: number;
  dietaryTags?: string[];
  modelId?: string;
}

export interface EditRecipeDto {
  userId: string;
  signal: AbortSignal;
  recipe: unknown;
  instruction: string;
  modelId?: string;
}

export interface AnalyzeNutritionDto {
  userId: string;
  signal: AbortSignal;
  recipe: unknown;
  modelId?: string;
}

export interface GenerateRecipeResult {
  recipe: RecipeDraft;
  tokensUsed: number;
  model: AiModelRoute;
}

export interface EditRecipeResult {
  recipe: RecipeDraft;
  summary: string;
  tokensUsed: number;
  model: AiModelRoute;
}

export interface AnalyzeNutritionResult {
  analysis: NutritionAnalysis;
  tokensUsed: number;
  model: AiModelRoute;
}
