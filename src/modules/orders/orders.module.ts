import { Module } from '@nestjs/common';
import { OrdersController } from './controllers';
import { GROCERY_PARTNER_TOKEN, ORDERS_SERVICE_TOKEN } from './constants';
import { MockGroceryPartnerService, OrdersService } from './services';

@Module({
  controllers: [OrdersController],
  providers: [
    MockGroceryPartnerService,
    OrdersService,
    {
      provide: GROCERY_PARTNER_TOKEN,
      useExisting: MockGroceryPartnerService,
    },
    {
      provide: ORDERS_SERVICE_TOKEN,
      useExisting: OrdersService,
    },
  ],
  exports: [ORDERS_SERVICE_TOKEN],
})
export class OrdersModule {}
