import { RecipeDraft } from '@modules/ai';
import type {
  AnalyzeNutritionDto,
  AnalyzeNutritionResult,
  EditRecipeDto,
  EditRecipeResult,
  ExtractRecipeFromHtmlDto,
  GenerateRecipeDto,
  GenerateRecipeResult,
} from '../dtos';

export interface IRecipeAiService {
  generateRecipe(params: GenerateRecipeDto): Promise<GenerateRecipeResult>;
  editRecipe(params: EditRecipeDto): Promise<EditRecipeResult>;
  extractRecipeFromHtml(params: ExtractRecipeFromHtmlDto): Promise<RecipeDraft | null>;
  analyzeNutrition(params: AnalyzeNutritionDto): Promise<AnalyzeNutritionResult>;
}
