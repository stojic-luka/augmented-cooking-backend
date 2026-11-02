import type { RecipeDraft } from '@modules/ai';

export interface ImportRecipeParams {
  userId: string;
  signal: AbortSignal;
  url: string;
}

export interface IRecipeImportService {
  importRecipe(params: ImportRecipeParams): Promise<{ recipe: RecipeDraft }>;
}
