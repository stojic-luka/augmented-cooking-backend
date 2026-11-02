import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for API errors. Produces the documented error body:
 * a flat `{ message }` (plus a machine-readable `code`) with a meaningful
 * HTTP status.
 */
export class ApiException extends HttpException {
  readonly code: string;

  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, code = 'ERR') {
    super({ code, message }, status);
    this.code = code;
  }
}
