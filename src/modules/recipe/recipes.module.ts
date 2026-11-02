import { Module } from '@nestjs/common';
import { AiModule } from '@modules/ai';
import { QuotaModule } from '@modules/quota';
import { RecipeAiController, RecipesController } from './controllers';
import { RECIPE_AI_SERVICE_TOKEN, RECIPE_IMPORT_SERVICE_TOKEN } from './constants';
import {
  RecipeAiService,
  RecipeHtmlFetcherService,
  RecipeImportService,
  UrlGuardService,
} from './services';

@Module({
  imports: [AiModule, QuotaModule],
  controllers: [RecipeAiController, RecipesController],
  providers: [
    RecipeAiService,
    RecipeImportService,
    RecipeHtmlFetcherService,
    UrlGuardService,
    {
      provide: RECIPE_AI_SERVICE_TOKEN,
      useExisting: RecipeAiService,
    },
    {
      provide: RECIPE_IMPORT_SERVICE_TOKEN,
      useExisting: RecipeImportService,
    },
  ],
})
export class RecipesModule {}
