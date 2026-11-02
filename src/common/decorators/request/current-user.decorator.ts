import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '@supabase/supabase-js';
import { Request } from 'express';

export const GetCurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);
