import { IsUrl, MaxLength } from 'class-validator';

export class ImportRecipeBodyDto {
  @IsUrl(
    { require_tld: true, protocols: ['https'], require_protocol: true },
    { message: 'url must be a valid https:// URL.' },
  )
  @MaxLength(2048)
  url!: string;
}
