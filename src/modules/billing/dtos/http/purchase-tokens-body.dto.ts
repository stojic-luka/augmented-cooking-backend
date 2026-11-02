import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class PurchaseTokensBodyDto {
  @Type(() => Number)
  @IsInt()
  @Min(1000, { message: 'Minimum top-up is 1,000 tokens.' })
  @Max(1000000, { message: 'Maximum top-up is 1,000,000 tokens.' })
  tokens!: number;
}
