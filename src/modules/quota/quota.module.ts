import { Module } from '@nestjs/common';
import { AiModule } from '@modules/ai';
import { QUOTA_SERVICE_TOKEN } from './constants';
import { QuotaRepository } from './repositories';
import { QuotaService } from './services';

@Module({
  imports: [AiModule],
  providers: [
    QuotaRepository,
    QuotaService,
    {
      provide: QUOTA_SERVICE_TOKEN,
      useExisting: QuotaService,
    },
  ],
  exports: [QUOTA_SERVICE_TOKEN],
})
export class QuotaModule {}
