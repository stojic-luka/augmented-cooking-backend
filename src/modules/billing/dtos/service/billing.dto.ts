export interface SubscribeDto {
  userId: string;
  planId: string;
}

export interface PurchaseTokensDto {
  userId: string;
  tokens: number;
}

export interface BillingIntentResult {
  status: 'pending';
  message: string;
}
