import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class AnalyzeNutritionBodyDto {
  /** Recipe draft; deeply validated against the draft schema in the service. */
  @IsObject({ message: 'recipe must be an object.' })
  recipe!: unknown;

  @IsOptional()
  @IsUUID('4', { message: 'modelId must be a valid UUIDv4.' })
  modelId?: string;
}
