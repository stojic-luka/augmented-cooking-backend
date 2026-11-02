import { Inject, Injectable } from '@nestjs/common';
import { GROCERY_PARTNER_TOKEN } from '../constants';
import type { CreateOrderDto } from '../dtos';
import type { GroceryOrderResult, IGroceryPartner, IOrdersService } from '../interfaces';

/**
 * Places grocery orders through the partner port. Only the partner sees the
 * item payload; receipt recording is the client's job (it inserts its own
 * `order_receipts` row through RLS — privacy by data minimization).
 */
@Injectable()
export class OrdersService implements IOrdersService {
  constructor(
    @Inject(GROCERY_PARTNER_TOKEN)
    private readonly groceryPartner: IGroceryPartner,
  ) {}

  async createOrder(params: CreateOrderDto): Promise<GroceryOrderResult> {
    const items = params.items.map((item) => ({
      name: item.name,
      quantity: item.quantity ?? null,
      unit: item.unit ?? null,
    }));

    return this.groceryPartner.placeOrder(items);
  }
}
