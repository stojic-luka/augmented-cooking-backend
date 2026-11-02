export interface GroceryOrderItem {
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface GroceryOrderResult {
  orderId: string;
  status: string;
}

/**
 * Port to the grocery partner. The real integration plugs in here; the app
 * never talks to the provider from the browser (the documented order payload
 * stays server-side until a real partner exists).
 */
export interface IGroceryPartner {
  readonly providerId: string;
  placeOrder(items: GroceryOrderItem[]): Promise<GroceryOrderResult>;
}
