import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from './constants';

/**
 * Shared service-role Supabase client. Bypasses RLS — every repository is
 * responsible for scoping queries by the authenticated user's id.
 */
@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createClient(
          configService.getOrThrow<string>('Supabase.Url'),
          configService.getOrThrow<string>('Supabase.ServiceRoleKey'),
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        ),
    },
  ],
  exports: [SUPABASE_CLIENT],
})
export class SupabaseModule {}
