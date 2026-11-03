import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../../src/app.module';
import { SupabaseAuthGuard } from '../../src/modules/auth';
import { SUPABASE_CLIENT } from '../../src/modules/supabase';
import {
  createFakeSupabaseClient,
  type FakeSupabaseClient,
  type FakeSupabaseConfig,
} from './fake-supabase.client.js';
import { TestAuthGuard, resetTestUser } from './test-auth.guard.js';

// The Supabase URL/key only need to exist for ConfigService.getOrThrow —
// the client itself is always replaced by the fake below. SUPABASE_PROJECT_URL
// is the variable the Supabase config namespace actually reads.
process.env.SUPABASE_PROJECT_URL ??= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';

export interface TestApp {
  app: INestApplication;
  supabase: FakeSupabaseClient;
  /** A supertest agent bound to the HTTP server. */
  http: () => supertest.Agent;
  close: () => Promise<void>;
}

async function buildApp(options: {
  useRealGuard: boolean;
  supabase: FakeSupabaseClient;
}): Promise<TestApp> {
  resetTestUser();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SUPABASE_CLIENT)
    .useValue(options.supabase)
    .overrideGuard(SupabaseAuthGuard)
    .useValue(
      options.useRealGuard
        ? new SupabaseAuthGuard(options.supabase as never)
        : new TestAuthGuard(),
    )
    .compile();

  const app = moduleRef.createNestApplication();
  // The global pipe/interceptor/filter are declared in AppModule
  // (APP_PIPE/APP_INTERCEPTOR/APP_FILTER), so no manual wiring is needed here.
  await app.init();

  const agent = supertest(app.getHttpServer());

  return {
    app,
    supabase: options.supabase,
    http: () => agent,
    close: () => app.close(),
  };
}

/** App with the lightweight test guard (fake user stamped on every request). */
export async function createTestApp(
  config?: FakeSupabaseConfig,
): Promise<TestApp> {
  return buildApp({
    useRealGuard: false,
    supabase: createFakeSupabaseClient(config),
  });
}

/** App with the real SupabaseAuthGuard backed by the fake client's auth API. */
export async function createRealGuardApp(
  config?: FakeSupabaseConfig,
): Promise<TestApp> {
  return buildApp({
    useRealGuard: true,
    supabase: createFakeSupabaseClient(config),
  });
}
