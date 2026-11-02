import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../api.exception';

/** The configured AI provider failed or is not reachable/configured. */
export class AiUnavailableException extends ApiException {
  constructor(message = 'The AI service is unavailable. Please try again later.') {
    super(message, HttpStatus.BAD_GATEWAY, 'AI_UNAVAILABLE');
  }
}
