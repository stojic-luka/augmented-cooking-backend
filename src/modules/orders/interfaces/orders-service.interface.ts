import type { GroceryOrderItem, GroceryOrderResult } from './grocery-partner.interface';

export interface CreateOrderParams {
  userId: string;
  shoppingListId?: string;
  items: GroceryOrderItem[];
}

export interface IOrdersService {
  createOrder(params: CreateOrderParams): Promise<GroceryOrderResult>;
}
