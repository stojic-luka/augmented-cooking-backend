import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../api.exception';

/**
 * One consistent, documented status for every exhausted limit:
 * free daily action cap or premium chat-token balance.
 */
export class QuotaExceededException extends ApiException {
  constructor(message: string) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, 'QUOTA_EXCEEDED');
  }
}
