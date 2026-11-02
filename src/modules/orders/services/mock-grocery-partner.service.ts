import { Injectable } from '@nestjs/common';
import type { GroceryOrderItem, GroceryOrderResult, IGroceryPartner } from '../interfaces';

/**
 * Offline mock for the grocery-partner port. Accepts every order and returns
 * a deterministic "placed" receipt — the documented contract without a real
 * provider. Swapping in the real partner means implementing this interface
 * and binding it to GROCERY_PARTNER_TOKEN (see README).
 */
@Injectable()
export class MockGroceryPartnerService implements IGroceryPartner {
  readonly providerId = 'partner-grocery-api';

  placeOrder(items: GroceryOrderItem[]): Promise<GroceryOrderResult> {
    const orderId = `ord_${Date.now().toString(36)}_${items.length}`;
    return Promise.resolve({ orderId, status: 'placed' });
  }
}
