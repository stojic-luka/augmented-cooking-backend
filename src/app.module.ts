import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { aiConfig, globalConfig, supabaseConfig } from '@config/index';
import { ApiExceptionFilter } from '@common/filters/api-exception.filter';
import { RequestCancellationInterceptor } from '@common/interceptors/request';
import { AiModule } from '@modules/ai';
import { AuthModule } from '@modules/auth';
import { BillingModule } from '@modules/billing';
import { ChatModule } from '@modules/chat';
import { OrdersModule } from '@modules/orders';
import { QuotaModule } from '@modules/quota';
import { RecipesModule } from '@modules/recipe';
import { SupabaseModule } from '@modules/supabase';
// import { MetricsModule } from 'apm-optima/nest';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [globalConfig, supabaseConfig, aiConfig],
      cache: true,
    }),
    SupabaseModule,
    AuthModule,
    QuotaModule,
    AiModule,
    RecipesModule,
    ChatModule,
    OrdersModule,
    BillingModule,
    // MetricsModule.forRoot({
    //   dashboard: {
    //     path: '/optima-metrics',
    //   },
    //   simulation: {
    //     intervalMs: 200,
    //     requestsPerTick: 250,
    //   },
    //   publisher: {
    //     intervalMs: 1000,
    //   },
    //   persistence: {
    //     baseDir: 'metrics_data',
    //     maxBufferSize: 1000,
    //     persistRawRequests: true,
    //   },
    //   tickIntervalMs: 250,
    // }),
  ],
  providers: [
    // Declared here (not in main.ts) so every entry point — production boot,
    // e2e harnesses — gets the identical request pipeline.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
    { provide: APP_INTERCEPTOR, useClass: RequestCancellationInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
