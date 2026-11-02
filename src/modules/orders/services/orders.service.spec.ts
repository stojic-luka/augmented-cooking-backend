import type { Mock } from 'vitest';
import type { IGroceryPartner } from '../interfaces';
import { MockGroceryPartnerService } from './mock-grocery-partner.service';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let partner: { placeOrder: Mock };
  let service: OrdersService;

  beforeEach(() => {
    partner = { placeOrder: vi.fn().mockResolvedValue({ orderId: 'ord_1', status: 'placed' }) };
    service = new OrdersService(partner as unknown as IGroceryPartner);
  });

  it('forwards the normalized items to the grocery partner', async () => {
    const result = await service.createOrder({
      userId: 'u1',
      shoppingListId: 'list-1',
      items: [
        { name: 'rice', quantity: 2, unit: 'kg' },
        { name: 'salt', quantity: null, unit: null },
      ],
    });

    expect(partner.placeOrder).toHaveBeenCalledWith([
      { name: 'rice', quantity: 2, unit: 'kg' },
      { name: 'salt', quantity: null, unit: null },
    ]);
    expect(result).toEqual({ orderId: 'ord_1', status: 'placed' });
  });

  it('returns the partner receipt untouched', async () => {
    partner.placeOrder.mockResolvedValue({ orderId: 'ord_9', status: 'placed' });

    const result = await service.createOrder({
      userId: 'u1',
      items: [{ name: 'flour', quantity: null, unit: null }],
    });

    expect(result).toEqual({ orderId: 'ord_9', status: 'placed' });
  });
});

describe('MockGroceryPartnerService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1735689600000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts every order with a deterministic receipt derived from the clock and item count', async () => {
    const partner = new MockGroceryPartnerService();

    const result = await partner.placeOrder([
      { name: 'rice', quantity: 1, unit: 'kg' },
      { name: 'salt', quantity: null, unit: null },
    ]);

    expect(partner.providerId).toBe('partner-grocery-api');
    expect(result).toEqual({
      orderId: `ord_${(1735689600000).toString(36)}_2`,
      status: 'placed',
    });
  });
});
