import { registerAs } from '@nestjs/config';

/**
 * The Supabase client built from these values carries the service-role key and
 * bypasses RLS. It must never be exposed to clients or logged.
 */
export default registerAs('Supabase', () => ({
  Url: process.env.SUPABASE_PROJECT_URL,
  ServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}));
