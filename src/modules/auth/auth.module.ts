import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './guards';

@Module({
  providers: [SupabaseAuthGuard],
  exports: [SupabaseAuthGuard],
})
export class AuthModule {}
