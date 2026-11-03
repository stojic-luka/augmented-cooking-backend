import { RecipeDraft, recipeDraftSchema } from '../../ai';
import { parseRecipeDraft } from './parse-recipe-draft';

/** schema.org `suitableForDiet` value → app `dietary_tag` vocabulary. */
const DIET_TAG_BY_SCHEMA_URL: Record<string, string> = {
  'https://schema.org/glutenfreediet': 'gluten_free',
  'https://schema.org/dairyfreediet': 'dairy_free',
  'https://schema.org/vegandiet': 'vegan',
  'https://schema.org/vegetariandiet': 'vegetarian',
  'https://schema.org/halaldiet': 'halal',
  'https://schema.org/kosherdiet': 'kosher',
  'https://schema.org/diabeticdiet': 'sugar_free',
  'https://schema.org/lowcaloriediet': 'low_carb',
  'https://schema.org/lowlactosediet': 'dairy_free',
};

/**
 * Maps a `recipe-scrapers` RecipeObject onto the recipe draft wire shape.
 * Returns null when the page did not yield the minimum viable recipe
 * (title + at least one ingredient and one step).
 */
export function normalizeScrapedRecipe(scraped: Record<string, unknown>): RecipeDraft | null {
  const candidate = {
    title: text(scraped.title) ?? '',
    description: text(scraped.description) ?? '',
    cuisine: firstText(scraped.cuisine) ?? '',
    prepTimeMinutes: minutes(scraped.prepTime) ?? minutes(scraped.totalTime),
    cookTimeMinutes: minutes(scraped.cookTime),
    servings: servingsFromYield(text(scraped.yields)),
    difficulty: null,
    image: text(scraped.image),
    ingredients: flattenItems(scraped.ingredients).map((item) => toDraftIngredient(item)),
    steps: flattenGroups(scraped.instructions)
      .map((value) => ({ instruction: value }))
      .filter((step) => step.instruction.length > 0),
    dietaryTags: mapDietTags(scraped.dietaryRestrictions),
  };

  if (!candidate.title || candidate.ingredients.length === 0 || candidate.steps.length === 0) {
    return null;
  }

  const parsed = recipeDraftSchema.safeParse(candidate);
  // Scraped data is only loosely controlled — fall back to the AI-draft
  // normalizer (which coerces amounts/times) before giving up.
  if (parsed.success) {
    return parsed.data;
  }

  try {
    return parseRecipeDraft(candidate);
  } catch {
    return null;
  }
}

interface ScrapedIngredientItem {
  value: string;
  parsed?: {
    quantity?: number | null;
    unitOfMeasure?: string | null;
    description?: string | null;
  } | null;
}

function toDraftIngredient(item: unknown): { name: string; amount: number | null; unit: string } {
  const value =
    typeof item === 'string' ? item : String((item as ScrapedIngredientItem)?.value ?? '');
  const parsed =
    typeof item === 'object' && item !== null ? (item as ScrapedIngredientItem).parsed : undefined;

  const name = (parsed?.description ?? value).trim();
  const amount =
    typeof parsed?.quantity === 'number' && Number.isFinite(parsed.quantity)
      ? parsed.quantity
      : null;
  const unit = (parsed?.unitOfMeasure ?? '').trim();

  return { name, amount, unit };
}

/** Flattens scraper groups ({name, items:[...]}) into the raw items. */
function flattenItems(groups: unknown): unknown[] {
  if (!Array.isArray(groups)) {
    return [];
  }
  return groups.flatMap((group) => {
    const items = (group as { items?: unknown[] })?.items;
    return Array.isArray(items) ? items : [];
  });
}

function flattenGroups(groups: unknown): string[] {
  return flattenItems(groups).map((item) =>
    typeof item === 'string' ? item.trim() : (text((item as { value?: unknown })?.value) ?? ''),
  );
}

/** ISO-8601 durations are resolved by the scraper; values are already minutes. */
function minutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

/** "Serves 4", "4 servings", "Makes 24 cookies" → 4; fallback 4 servings. */
function servingsFromYield(yields: string | null): number {
  if (!yields) {
    return 4;
  }
  const match = /\d+/.exec(yields);
  const parsed = match ? Number(match[0]) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

function mapDietTags(restrictions: unknown): string[] {
  if (!Array.isArray(restrictions)) {
    return [];
  }
  const tags = restrictions
    .map((value) => DIET_TAG_BY_SCHEMA_URL[String(value).toLowerCase()])
    .filter((tag): tag is string => Boolean(tag));
  return Array.from(new Set(tags));
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstText(value: unknown): string | null {
  return Array.isArray(value) ? text(value[0]) : null;
}
