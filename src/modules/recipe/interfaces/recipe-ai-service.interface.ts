import type {
  AnalyzeNutritionDto,
  AnalyzeNutritionResult,
  EditRecipeDto,
  EditRecipeResult,
  GenerateRecipeDto,
  GenerateRecipeResult,
} from '../dtos';

export interface IRecipeAiService {
  generateRecipe(params: GenerateRecipeDto): Promise<GenerateRecipeResult>;
  editRecipe(params: EditRecipeDto): Promise<EditRecipeResult>;
  analyzeNutrition(params: AnalyzeNutritionDto): Promise<AnalyzeNutritionResult>;
}
