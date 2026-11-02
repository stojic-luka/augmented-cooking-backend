import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { Request } from 'express';
import { RequestCancellationInterceptor } from './request-cancellation.interceptor';

function createRequest(): Request & { abortSignal?: AbortSignal } {
  return new EventEmitter() as unknown as Request;
}

function createContext(request: Request): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('RequestCancellationInterceptor', () => {
  const handler: CallHandler = { handle: () => of('ok') };

  it('attaches a non-aborted signal to the request and lets the handler run', async () => {
    const interceptor = new RequestCancellationInterceptor();
    const request = createRequest();

    const result = await new Promise<string>((resolve) => {
      interceptor.intercept(createContext(request), handler).subscribe((value) => resolve(value as string));
    });

    expect(result).toBe('ok');
    expect(request.abortSignal).toBeInstanceOf(AbortSignal);
    expect(request.abortSignal?.aborted).toBe(false);
  });

  it('aborts the request signal when the underlying connection closes', async () => {
    const interceptor = new RequestCancellationInterceptor();
    const request = createRequest();

    await new Promise<void>((resolve) => {
      interceptor.intercept(createContext(request), handler).subscribe(() => resolve());
    });

    request.emit('close');

    expect(request.abortSignal?.aborted).toBe(true);
  });

  it('does not abort twice when close fires after an explicit abort', async () => {
    const interceptor = new RequestCancellationInterceptor();
    const request = createRequest();

    await new Promise<void>((resolve) => {
      interceptor.intercept(createContext(request), handler).subscribe(() => resolve());
    });

    request.abortSignal?.dispatchEvent(new Event('abort'));
    expect(() => request.emit('close')).not.toThrow();
    expect(request.abortSignal?.aborted).toBe(true);
  });
});
