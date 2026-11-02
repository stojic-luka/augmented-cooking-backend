import type { GroceryOrderItem } from '../../interfaces';

export interface CreateOrderDto {
  userId: string;
  shoppingListId?: string;
  items: GroceryOrderItem[];
}
