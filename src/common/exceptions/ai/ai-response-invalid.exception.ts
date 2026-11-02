import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../api.exception';

/** The LLM answered but its output could not be parsed/validated. */
export class AiResponseInvalidException extends ApiException {
  constructor(message = 'The AI service returned an invalid response. Please try again.') {
    super(message, HttpStatus.BAD_GATEWAY, 'AI_RESPONSE_INVALID');
  }
}
