import { z } from 'zod';
import {
  NutritionAnalysis,
  RecipeDraft,
  nutritionAnalysisSchema,
  recipeDraftSchema,
} from '@modules/ai';

const looseNumber = z.union([z.number(), z.string()]).transform(Number);

/**
 * Accepts what providers realistically emit (numbers as strings, 0 for "no
 * cook time", bare strings for steps) and normalizes it into a RecipeDraft.
 * Throws an Error listing every validation problem so the AI repair retry
 * receives actionable feedback.
 */
export function parseRecipeDraft(value: unknown): RecipeDraft {
  const normalized = normalizeDraft(value);
  const result = recipeDraftSchema.safeParse(normalized);

  if (!result.success) {
    throw new Error(formatIssues('recipe draft', result.error));
  }
  return result.data;
}

export function parseEditRecipeResponse(value: unknown): { recipe: RecipeDraft; summary: string } {
  const root = asObject(value);
  const recipe = parseRecipeDraft(root.recipe);
  const summary =
    typeof root.summary === 'string' && root.summary.trim() ? root.summary.trim() : '';

  if (!summary) {
    throw new Error('Missing "summary" describing the applied changes.');
  }
  return { recipe, summary };
}

/** Parses and validates the analyze-nutrition payload, coercing loose numbers. */
export function parseNutritionAnalysis(value: unknown): NutritionAnalysis {
  const schema = nutritionAnalysisSchema.extend({
    caloriesPerServing: positiveNumber('caloriesPerServing'),
    proteinGrams: nonNegativeNumber('proteinGrams'),
    carbsGrams: nonNegativeNumber('carbsGrams'),
    fatGrams: nonNegativeNumber('fatGrams'),
    suggestions: z.array(z.string().min(1)).catch([]),
  });

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(formatIssues('nutrition analysis', result.error));
  }
  return {
    caloriesPerServing: result.data.caloriesPerServing,
    proteinGrams: result.data.proteinGrams,
    carbsGrams: result.data.carbsGrams,
    fatGrams: result.data.fatGrams,
    suggestions: result.data.suggestions,
  };
}

/**
 * Validates a recipe the CLIENT sent (edit/analyze endpoints). Not normalized
 * beyond the wire shape: invalid drafts are rejected with HTTP 400.
 */
export function parseClientRecipeDraft(value: unknown): RecipeDraft {
  const result = recipeDraftSchema.safeParse(value);
  if (!result.success) {
    throw new Error(formatIssues('recipe', result.error));
  }
  return result.data;
}

function normalizeDraft(value: unknown): unknown {
  const root = asObject(value);

  const ingredients = Array.isArray(root.ingredients)
    ? root.ingredients.map((item) => {
        const ingredient = asObject(item);
        const amount =
          ingredient.amount === null || ingredient.amount === undefined || ingredient.amount === ''
            ? null
            : Number(ingredient.amount);
        return {
          name: toText(ingredient.name),
          amount: Number.isFinite(amount) ? amount : null,
          unit: toText(ingredient.unit),
        };
      })
    : [];

  const steps = Array.isArray(root.steps)
    ? root.steps.map((item) => ({
        instruction: typeof item === 'string' ? item.trim() : toText(asObject(item).instruction),
      }))
    : [];

  const cookTime = toInt(root.cookTimeMinutes);

  return {
    ...root,
    title: toText(root.title),
    difficulty: normalizeDifficulty(root.difficulty),
    prepTimeMinutes: toInt(root.prepTimeMinutes) ?? 30,
    // 0 from the model means "no cooking" — the wire shape wants null.
    cookTimeMinutes: cookTime !== null && cookTime > 0 ? cookTime : null,
    servings: toInt(root.servings) ?? 4,
    ingredients,
    steps,
    dietaryTags: Array.isArray(root.dietaryTags) ? root.dietaryTags.map((tag) => toText(tag)) : [],
  };
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDifficulty(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const lowered = value.trim().toLowerCase();
  return ['easy', 'medium', 'hard'].includes(lowered) ? lowered : null;
}

function toInt(value: unknown): number | null {
  const parsed = looseNumber.safeParse(value);
  if (!parsed.success || !Number.isFinite(parsed.data)) {
    return null;
  }
  return Math.round(parsed.data);
}

function positiveNumber(field: string) {
  return looseNumber.refine((n) => Number.isFinite(n) && n > 0, {
    message: `${field} must be > 0`,
  });
}

function nonNegativeNumber(field: string) {
  return looseNumber.refine((n) => Number.isFinite(n) && n >= 0, {
    message: `${field} must be >= 0`,
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function formatIssues(subject: string, error: z.ZodError): string {
  return `Invalid ${subject}: ${error.issues.map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`;
}
