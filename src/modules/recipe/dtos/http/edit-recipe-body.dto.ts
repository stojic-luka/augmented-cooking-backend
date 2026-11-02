import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class EditRecipeBodyDto {
  /** Recipe draft; deeply validated against the draft schema in the service. */
  @IsObject({ message: 'recipe must be an object.' })
  recipe!: unknown;

  @IsString()
  @MinLength(1, { message: 'Describe the change you want.' })
  @MaxLength(2000)
  instruction!: string;

  @IsOptional()
  @IsUUID('4', { message: 'modelId must be a valid UUIDv4.' })
  modelId?: string;
}
