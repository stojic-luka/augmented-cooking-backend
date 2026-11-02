import { Module } from '@nestjs/common';
import { BillingController } from './controllers';
import { BILLING_SERVICE_TOKEN } from './constants';
import { BillingService } from './services';

@Module({
  controllers: [BillingController],
  providers: [
    BillingService,
    {
      provide: BILLING_SERVICE_TOKEN,
      useExisting: BillingService,
    },
  ],
  exports: [BILLING_SERVICE_TOKEN],
})
export class BillingModule {}
