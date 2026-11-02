import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChatTurnDto {
  @IsIn(['user', 'assistant'], { message: 'role must be "user" or "assistant".' })
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;
}

export class SendChatMessageBodyDto {
  /** Client-generated session id (frontend keeps history locally). */
  @IsUUID('4', { message: 'sessionId must be a valid UUIDv4.' })
  sessionId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChatTurnDto)
  messages!: ChatTurnDto[];

  @IsOptional()
  @IsUUID('4', { message: 'modelId must be a valid UUIDv4.' })
  modelId?: string;
}
