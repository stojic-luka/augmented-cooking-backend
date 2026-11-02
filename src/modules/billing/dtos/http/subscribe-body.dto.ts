import { IsUUID } from 'class-validator';

export class SubscribeBodyDto {
  @IsUUID('4', { message: 'planId must be a valid UUIDv4.' })
  planId!: string;
}
