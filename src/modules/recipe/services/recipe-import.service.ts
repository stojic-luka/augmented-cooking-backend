import { Injectable } from '@nestjs/common';
import { RecipeDraft } from '../../ai';
import { RecipeImportException } from '../../../common/exceptions/index';
import { RecipeHtmlFetcherService } from './recipe-html-fetcher.service';
import type { ImportRecipeParams, IRecipeAiService, IRecipeImportService } from '../interfaces';

/**
 * Scrapes a recipe from a public URL. Parsing is done by `recipe-scrapers`
 * (site-specific scrapers with schema.org JSON-LD / microdata fallback) and
 * normalized into the same draft shape the AI endpoints return — no AI call,
 * no quota consumption.
 */
@Injectable()
export class RecipeImportService implements IRecipeImportService {
  constructor(
    private readonly recipeAiService: IRecipeAiService,
    private readonly htmlFetcher: RecipeHtmlFetcherService,
  ) {}

  async importRecipe(params: ImportRecipeParams): Promise<{ recipe: RecipeDraft }> {
    // The fetcher validates the URL (and every redirect hop) before each
    // request; DNS answers can differ per hop so no result is cached here.
    const html = await this.htmlFetcher.fetchHtml(params.url, params.signal);
    const draft = await this.recipeAiService.extractRecipeFromHtml({
      html,
      sourceUrl: params.url,
      userId: params.userId,
      modelId: params.modelId || 'gpt-4.1-mini',
      signal: params.signal,
    });

    if (!draft) {
      throw new RecipeImportException();
    }
    return { recipe: draft };
  }
}
