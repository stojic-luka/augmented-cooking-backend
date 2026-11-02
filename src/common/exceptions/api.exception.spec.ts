import { HttpStatus } from '@nestjs/common';
import { ApiException } from './api.exception';
import { AiResponseInvalidException, AiUnavailableException } from './ai';
import { InvalidAccessTokenException } from './auth';
import { QuotaExceededException } from './quota';
import { InvalidRecipeUrlException, RecipeImportException } from './recipe';

describe('ApiException', () => {
  it('defaults to 400 BAD_REQUEST with the generic ERR code', () => {
    const error = new ApiException('something failed');

    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.code).toBe('ERR');
    expect(error.getResponse()).toEqual({ code: 'ERR', message: 'something failed' });
  });

  it('accepts a custom status and code', () => {
    const error = new ApiException('teapot', HttpStatus.I_AM_A_TEAPOT, 'TEAPOT');

    expect(error.getStatus()).toBe(418);
    expect(error.code).toBe('TEAPOT');
  });
});

describe('documented exception catalogue', () => {
  const cases: Array<[() => ApiException, number, string]> = [
    [() => new AiResponseInvalidException(), HttpStatus.BAD_GATEWAY, 'AI_RESPONSE_INVALID'],
    [() => new AiUnavailableException(), HttpStatus.BAD_GATEWAY, 'AI_UNAVAILABLE'],
    [() => new QuotaExceededException('limit'), HttpStatus.TOO_MANY_REQUESTS, 'QUOTA_EXCEEDED'],
    [() => new InvalidRecipeUrlException(), HttpStatus.BAD_REQUEST, 'INVALID_RECIPE_URL'],
    [() => new RecipeImportException(), HttpStatus.BAD_GATEWAY, 'RECIPE_IMPORT_FAILED'],
  ];

  it.each(cases)('%# produces the documented status and code', (factory, status, code) => {
    const error = factory();
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code });
  });
});

describe('auth exceptions', () => {
  it('InvalidAccessTokenException defaults to 401 INVALID_ACCESS_TOKEN', () => {
    const error = new InvalidAccessTokenException();

    expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(error.getResponse()).toEqual({
      code: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid access token',
    });
  });
});
