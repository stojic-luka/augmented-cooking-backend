import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import { Request } from 'express';

export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';

let currentUser: Partial<AuthUser> = {
  id: TEST_USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'free@test.local',
};

/** Lightweight stand-in for SupabaseAuthGuard: stamps a fake user on the request. */
@Injectable()
export class TestAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    request.user = currentUser as AuthUser;
    return true;
  }
}

export function setTestUser(user: Partial<AuthUser>): void {
  currentUser = { ...currentUser, ...user };
}

export function resetTestUser(): void {
  currentUser = {
    id: TEST_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'free@test.local',
  };
}
