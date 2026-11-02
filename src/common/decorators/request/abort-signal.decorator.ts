import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const GetAbortSignal = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AbortSignal => {
    const request: Request = ctx.switchToHttp().getRequest();
    return request.abortSignal;
  },
);
