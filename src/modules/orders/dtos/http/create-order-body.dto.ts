import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  quantity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;
}

export class CreateOrderBodyDto {
  @IsOptional()
  @IsUUID('4', { message: 'shoppingListId must be a valid UUIDv4.' })
  shoppingListId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Add at least one item to order.' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}
