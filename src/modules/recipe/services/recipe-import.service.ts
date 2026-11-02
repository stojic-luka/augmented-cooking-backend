import { Injectable } from '@nestjs/common';
import { RecipeDraft } from '@modules/ai';
import { RecipeImportException } from '@exceptions/index';
import { normalizeScrapedRecipe } from '../schemas/scraped-recipe.mapper';
import { RecipeHtmlFetcherService } from './recipe-html-fetcher.service';
import { loadRecipeScrapers } from '@lib/recipe-scrapers';
import type { ImportRecipeParams, IRecipeImportService } from '../interfaces';

/**
 * Scrapes a recipe from a public URL. Parsing is done by `recipe-scrapers`
 * (site-specific scrapers with schema.org JSON-LD / microdata fallback) and
 * normalized into the same draft shape the AI endpoints return — no AI call,
 * no quota consumption.
 */
@Injectable()
export class RecipeImportService implements IRecipeImportService {
  constructor(private readonly htmlFetcher: RecipeHtmlFetcherService) {}

  async importRecipe(params: ImportRecipeParams): Promise<{ recipe: RecipeDraft }> {
    // The fetcher validates the URL (and every redirect hop) before each
    // request; DNS answers can differ per hop so no result is cached here.
    const html = await this.htmlFetcher.fetchHtml(params.url, params.signal);
    const scraped = await this.scrape(html, params.url);

    const draft = normalizeScrapedRecipe(scraped);
    if (!draft) {
      throw new RecipeImportException();
    }
    return { recipe: draft };
  }

  private async scrape(html: string, url: string): Promise<Record<string, unknown>> {
    const { scrapeRecipe } = await loadRecipeScrapers();

    const result = await scrapeRecipe(html, url, { safeParse: true });
    if (!result.success) {
      throw new RecipeImportException();
    }

    return result.data;
  }
}
