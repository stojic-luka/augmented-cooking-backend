import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Request, Response } from 'express';
import { AiUnavailableException, QuotaExceededException } from '@exceptions/index';
import { ApiExceptionFilter } from './api-exception.filter';

function createHost(request: Partial<Request>) {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  const host: ArgumentsHost = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ApiExceptionFilter', () => {
  const request = { method: 'POST', url: '/ai/generate-recipe' } as Request;
  let filter: ApiExceptionFilter;

  beforeEach(() => {
    filter = new ApiExceptionFilter();
  });

  it('maps a string HttpException body to `{ code: "ERR", message }`', () => {
    const { host, status, json } = createHost(request);

    filter.catch(new ForbiddenException('nope'), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ code: 'ERR', message: 'nope' });
  });

  it('keeps the machine-readable code of an ApiException subclass', () => {
    const { host, status, json } = createHost(request);

    filter.catch(new QuotaExceededException('Daily AI action limit reached.'), host);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      code: 'QUOTA_EXCEEDED',
      message: 'Daily AI action limit reached.',
    });
  });

  it('joins class-validator message arrays into one string', () => {
    const { host, json } = createHost(request);
    const validationError = new BadRequestException([
      'ingredients must be an array',
      'ingredients should not be empty',
    ]);

    filter.catch(validationError, host);

    expect(json).toHaveBeenCalledWith({
      code: 'ERR',
      message: 'ingredients must be an array; ingredients should not be empty',
    });
  });

  it('falls back to the exception message when the body has none', () => {
    const { host, json } = createHost(request);

    filter.catch(new HttpException({ code: 'X' }, 400), host);

    expect(json).toHaveBeenCalledWith({ code: 'X', message: 'Http Exception' });
  });

  it('maps unknown exceptions to 500 with the raw error message', () => {
    const { host, status, json } = createHost(request);

    filter.catch(new Error('database exploded'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: 'ERR', message: 'database exploded' });
  });

  it('maps non-Error throwables to the generic message', () => {
    const { host, json } = createHost(request);

    filter.catch('a string was thrown', host);

    expect(json).toHaveBeenCalledWith({ code: 'ERR', message: 'a string was thrown' });
  });

  it('preserves the documented status/code pairs of the API exception catalogue', () => {
    const { host, status, json } = createHost(request);

    filter.catch(new AiUnavailableException(), host);

    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({
      code: 'AI_UNAVAILABLE',
      message: 'The AI service is unavailable. Please try again later.',
    });
  });
});
