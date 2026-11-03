import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AiJsonService, RecipeDraft } from '../../ai';
import { QUOTA_SERVICE_TOKEN, type QuotaReservation } from '../../quota';
import type { IQuotaService } from '../../quota';
import { getErrorMessage } from '../../../utils/index';
import {
  EDIT_RECIPE_RESPONSE_JSON_SCHEMA,
  NUTRITION_ANALYSIS_JSON_SCHEMA,
  RECIPE_DRAFT_JSON_SCHEMA,
} from '../schemas';
import {
  ANALYZE_NUTRITION_SYSTEM_PROMPT,
  EDIT_RECIPE_SYSTEM_PROMPT,
  GENERATE_RECIPE_SYSTEM_PROMPT,
} from '../prompts';
import { parseEditRecipeResponse, parseNutritionAnalysis, parseRecipeDraft } from '../schemas';
import type {
  AnalyzeNutritionDto,
  AnalyzeNutritionResult,
  EditRecipeDto,
  EditRecipeResult,
  GenerateRecipeDto,
  GenerateRecipeResult,
} from '../dtos';
import type { IRecipeAiService } from '../interfaces';
import { parseClientRecipeDraft } from '../schemas/parse-recipe-draft';

/**
 * Stateless AI recipe endpoints: drafts go in, drafts come out — nothing is
 * persisted (the client saves through Supabase). Every call reserves quota
 * first, and on success completes it with the real token usage; provider
 * failures release the reservation so abandoned slots don't burn the
 * caller's daily cap.
 */
@Injectable()
export class RecipeAiService implements IRecipeAiService {
  private readonly logger = new Logger(RecipeAiService.name);

  constructor(
    private readonly aiJson: AiJsonService,
    @Inject(QUOTA_SERVICE_TOKEN)
    private readonly quotaService: IQuotaService,
  ) {}

  async generateRecipe(params: GenerateRecipeDto): Promise<GenerateRecipeResult> {
    const reservation = await this.quotaService.reserve({
      userId: params.userId,
      action: 'generate_recipe',
      modelId: params.modelId,
    });

    const userPrompt = this.buildGenerateUserPrompt(params);

    try {
      const { data, usage, model } = await this.aiJson.generateValidated({
        options: this.buildOptions(params, reservation, 'gen-recipe'),
        systemPrompt: GENERATE_RECIPE_SYSTEM_PROMPT,
        userPrompt,
        jsonSchema: RECIPE_DRAFT_JSON_SCHEMA,
        parse: parseRecipeDraft,
      });

      await this.quotaService.complete({ reservation, model, ...usage });

      return { recipe: data, tokensUsed: usage.totalTokens, model: reservation.route };
    } catch (error) {
      await this.releaseQuietly(reservation);
      throw error;
    }
  }

  async editRecipe(params: EditRecipeDto): Promise<EditRecipeResult> {
    let currentDraft: RecipeDraft;
    try {
      currentDraft = parseClientRecipeDraft(params.recipe);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const reservation = await this.quotaService.reserve({
      userId: params.userId,
      action: 'edit_recipe',
      modelId: params.modelId,
    });

    try {
      const { data, usage, model } = await this.aiJson.generateValidated({
        options: this.buildOptions(params, reservation, 'edit-recipe'),
        systemPrompt: EDIT_RECIPE_SYSTEM_PROMPT,
        userPrompt: [
          'Current recipe:',
          JSON.stringify(currentDraft, null, 2),
          '',
          'Requested change:',
          params.instruction,
        ].join('\n'),
        jsonSchema: EDIT_RECIPE_RESPONSE_JSON_SCHEMA,
        parse: parseEditRecipeResponse,
      });

      await this.quotaService.complete({ reservation, model, ...usage });

      return {
        recipe: data.recipe,
        summary: data.summary,
        tokensUsed: usage.totalTokens,
        model: reservation.route,
      };
    } catch (error) {
      await this.releaseQuietly(reservation);
      throw error;
    }
  }

  async analyzeNutrition(params: AnalyzeNutritionDto): Promise<AnalyzeNutritionResult> {
    let currentDraft: RecipeDraft;
    try {
      currentDraft = parseClientRecipeDraft(params.recipe);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const reservation = await this.quotaService.reserve({
      userId: params.userId,
      action: 'nutrition_analysis',
      modelId: params.modelId,
    });

    try {
      const { data, usage, model } = await this.aiJson.generateValidated({
        options: this.buildOptions(params, reservation, 'analyze-nutrition'),
        systemPrompt: ANALYZE_NUTRITION_SYSTEM_PROMPT,
        userPrompt: `Recipe:\n${JSON.stringify(currentDraft, null, 2)}`,
        jsonSchema: NUTRITION_ANALYSIS_JSON_SCHEMA,
        parse: parseNutritionAnalysis,
      });

      await this.quotaService.complete({ reservation, model, ...usage });

      return { analysis: data, tokensUsed: usage.totalTokens, model: reservation.route };
    } catch (error) {
      await this.releaseQuietly(reservation);
      throw error;
    }
  }

  /** Best-effort release: a failed release must never mask the original error. */
  private async releaseQuietly(reservation: QuotaReservation): Promise<void> {
    try {
      await this.quotaService.release(reservation);
    } catch (releaseError) {
      this.logger.warn(
        `Failed to release AI usage reservation ${reservation.usageId}: ${getErrorMessage(releaseError)}`,
      );
    }
  }

  private buildOptions(
    params: { userId: string; signal: AbortSignal; modelId?: string },
    reservation: QuotaReservation,
    prefix: string,
  ) {
    return {
      userId: params.userId,
      requestId: `${prefix}-${params.userId}-${Date.now()}`,
      provider: reservation.route.provider === 'default' ? undefined : reservation.route.provider,
      model: reservation.route.providerModel,
      temperature: 0.6,
      signal: params.signal,
    };
  }

  private buildGenerateUserPrompt(params: GenerateRecipeDto): string {
    const lines = [`Ingredients on hand: ${params.ingredients.join(', ')}.`];
    if (params.cuisine) {
      lines.push(`Cuisine: ${params.cuisine}.`);
    }
    if (params.maxCalories !== undefined) {
      lines.push(`Maximum calories per serving: ${params.maxCalories} kcal.`);
    }
    if (params.maxPrepMinutes !== undefined) {
      lines.push(`Maximum preparation time: ${params.maxPrepMinutes} minutes.`);
    }
    if (params.dietaryTags?.length) {
      lines.push(`Dietary requirements: ${params.dietaryTags.join(', ')}.`);
    }
    return lines.join('\n');
  }
}
