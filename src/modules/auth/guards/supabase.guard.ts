import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { AuthUser, SupabaseClient } from '@supabase/supabase-js';
import { Request } from 'express';
import { SUPABASE_CLIENT } from '../../supabase';
import { InvalidAccessTokenException } from '../../../common/exceptions/index';

/**
 * Validates the Supabase access token against the auth server and exposes the
 * user on `request.user`. No local JWT verification: Supabase is the source
 * of truth (signature and revocation).
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = await this.authenticate(request);

    if (!user) {
      throw new InvalidAccessTokenException();
    }

    request.user = user;
    return true;
  }

  private async authenticate(request: Request): Promise<AuthUser | null> {
    const token = this.extractToken(request);
    if (!token) {
      return null;
    }

    const {
      data: { user },
      error,
    } = await this.supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return user;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return null;
    }
    return header.slice('Bearer '.length).trim() || null;
  }
}
