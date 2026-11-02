import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getErrorMessage } from '../../utils';

/**
 * Produces the documented error convention: meaningful HTTP status,
 * body `{ message: string }` (plus a machine-readable `code` when known).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, body } = this.buildErrorBody(exception);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url} failed`, (exception as Error)?.stack);
    }

    response.status(status).json(body);
  }

  private buildErrorBody(exception: unknown): {
    status: number;
    body: { code: string; message: string };
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        return { status, body: { code: 'ERR', message: body } };
      }

      const { code, message } = body as { code?: string; message?: string | string[] };
      return {
        status,
        body: {
          code: code ?? 'ERR',
          message: Array.isArray(message) ? message.join('; ') : (message ?? exception.message),
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'ERR', message: getErrorMessage(exception) },
    };
  }
}
