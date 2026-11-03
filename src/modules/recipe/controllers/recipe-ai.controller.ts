import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import { GetAbortSignal, GetCurrentUser } from '../../../common/decorators/request';
import { SupabaseAuthGuard } from '../../auth';
import { AnalyzeNutritionBodyDto, EditRecipeBodyDto, GenerateRecipeBodyDto } from '../dtos';
import type { IRecipeAiService } from '../interfaces';
import { RECIPE_AI_SERVICE_TOKEN } from '../constants';

/**
 * Documented AI endpoints (see docs/API_ENDPOINTS.md). All return drafts —
 * persistence happens client-side through Supabase.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('ai')
export class RecipeAiController {
  constructor(
    @Inject(RECIPE_AI_SERVICE_TOKEN)
    private readonly recipeAiService: IRecipeAiService,
  ) {}

  @Post('generate-recipe')
  @HttpCode(HttpStatus.CREATED)
  async generateRecipe(
    @Body() body: GenerateRecipeBodyDto,
    @GetCurrentUser() user: AuthUser,
    @GetAbortSignal() signal: AbortSignal,
  ) {
    const { recipe, tokensUsed } = await this.recipeAiService.generateRecipe({
      userId: user.id,
      signal,
      ingredients: body.ingredients,
      cuisine: body.cuisine,
      maxCalories: body.maxCalories,
      maxPrepMinutes: body.maxPrepMinutes,
      dietaryTags: body.dietaryTags,
      modelId: body.modelId,
    });

    return { recipe, tokensUsed };
  }

  @Post('edit-recipe')
  @HttpCode(HttpStatus.OK)
  async editRecipe(
    @Body() body: EditRecipeBodyDto,
    @GetCurrentUser() user: AuthUser,
    @GetAbortSignal() signal: AbortSignal,
  ) {
    const { recipe, summary, tokensUsed } = await this.recipeAiService.editRecipe({
      userId: user.id,
      signal,
      recipe: body.recipe,
      instruction: body.instruction,
      modelId: body.modelId,
    });

    return { recipe, summary, tokensUsed };
  }

  @Post('analyze-nutrition')
  @HttpCode(HttpStatus.OK)
  async analyzeNutrition(
    @Body() body: AnalyzeNutritionBodyDto,
    @GetCurrentUser() user: AuthUser,
    @GetAbortSignal() signal: AbortSignal,
  ) {
    const { analysis } = await this.recipeAiService.analyzeNutrition({
      userId: user.id,
      signal,
      recipe: body.recipe,
      modelId: body.modelId,
    });

    return analysis;
  }
}
