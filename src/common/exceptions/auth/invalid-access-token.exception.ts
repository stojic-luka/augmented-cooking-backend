import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidAccessTokenException extends HttpException {
  constructor(message: string = 'Invalid access token', code: string = 'INVALID_ACCESS_TOKEN') {
    super({ code, message }, HttpStatus.UNAUTHORIZED);
  }
}
