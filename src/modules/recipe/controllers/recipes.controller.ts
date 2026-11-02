import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import { GetAbortSignal, GetCurrentUser } from '@common/decorators/request';
import { SupabaseAuthGuard } from '@modules/auth';
import { Inject } from '@nestjs/common';
import { ImportRecipeBodyDto } from '../dtos';
import { RECIPE_IMPORT_SERVICE_TOKEN } from '../constants';
import type { IRecipeImportService } from '../interfaces';

@UseGuards(SupabaseAuthGuard)
@Controller('recipes')
export class RecipesController {
  constructor(
    @Inject(RECIPE_IMPORT_SERVICE_TOKEN)
    private readonly recipeImportService: IRecipeImportService,
  ) {}

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  async importRecipe(
    @Body() body: ImportRecipeBodyDto,
    @GetCurrentUser() user: AuthUser,
    @GetAbortSignal() signal: AbortSignal,
  ) {
    const { recipe } = await this.recipeImportService.importRecipe({
      userId: user.id,
      signal,
      url: body.url,
    });

    return { recipe };
  }
}
