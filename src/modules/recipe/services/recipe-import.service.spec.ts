import type { Mock } from 'vitest';
import type { RecipeDraft } from '@modules/ai';
import { RecipeImportException } from '@exceptions/index';
import { RecipeHtmlFetcherService } from './recipe-html-fetcher.service';
import { RecipeImportService } from './recipe-import.service';

vi.mock('@lib/recipe-scrapers', () => ({ loadRecipeScrapers: vi.fn() }));

import { loadRecipeScrapers } from '@lib/recipe-scrapers';

const mockLoad = loadRecipeScrapers as unknown as Mock;

function scrapeResult(success: boolean, data: Record<string, unknown> | null = null) {
  return { success, data };
}

describe('RecipeImportService', () => {
  let fetchHtml: Mock;
  let scrapeRecipe: Mock;
  let service: RecipeImportService;

  beforeEach(() => {
    fetchHtml = vi.fn();
    scrapeRecipe = vi.fn();
    mockLoad.mockResolvedValue({ scrapeRecipe });
    service = new RecipeImportService({
      fetchHtml,
    } as unknown as RecipeHtmlFetcherService);
  });

  it('fetches, scrapes and normalizes into a recipe draft without consuming AI quota', async () => {
    fetchHtml.mockResolvedValue('<html>…</html>');
    scrapeRecipe.mockResolvedValue(
      scrapeResult(true, {
        title: 'Pancakes',
        yields: 'Serves 4',
        ingredients: [
          {
            name: 'Batter',
            items: [
              {
                value: '200 g flour',
                parsed: { quantity: 200, unitOfMeasure: 'g', description: 'flour' },
              },
            ],
          },
        ],
        instructions: [{ name: 'Cook', items: [{ value: 'Whisk and fry.' }] }],
      }),
    );

    const { recipe } = await service.importRecipe({
      userId: 'u1',
      signal: new AbortController().signal,
      url: 'https://example.blog/pancakes',
    });

    expect(fetchHtml).toHaveBeenCalledWith(
      'https://example.blog/pancakes',
      expect.any(AbortSignal),
    );
    expect(scrapeRecipe).toHaveBeenCalledWith('<html>…</html>', 'https://example.blog/pancakes', {
      safeParse: true,
    });
    expect(recipe).toEqual<RecipeDraft>({
      title: 'Pancakes',
      description: '',
      cuisine: '',
      prepTimeMinutes: 30,
      cookTimeMinutes: null,
      servings: 4,
      difficulty: null,
      image: null,
      ingredients: [{ name: 'flour', amount: 200, unit: 'g' }],
      steps: [{ instruction: 'Whisk and fry.' }],
      dietaryTags: [],
    });
  });

  it('throws RecipeImportException when the scraper cannot parse the page', async () => {
    fetchHtml.mockResolvedValue('<html>not a recipe</html>');
    scrapeRecipe.mockResolvedValue(scrapeResult(false));

    await expect(
      service.importRecipe({
        userId: 'u1',
        signal: new AbortController().signal,
        url: 'https://example.blog/whatever',
      }),
    ).rejects.toThrow(new RecipeImportException());
  });

  it('throws RecipeImportException when the page has no minimum viable recipe', async () => {
    fetchHtml.mockResolvedValue('<html>empty</html>');
    scrapeRecipe.mockResolvedValue(scrapeResult(true, { title: '' }));

    await expect(
      service.importRecipe({
        userId: 'u1',
        signal: new AbortController().signal,
        url: 'https://example.blog/empty',
      }),
    ).rejects.toThrow(new RecipeImportException());
  });
});
