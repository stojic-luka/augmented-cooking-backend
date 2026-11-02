import type { BillingIntentResult, PurchaseTokensDto, SubscribeDto } from '../dtos';

export interface IBillingService {
  subscribe(params: SubscribeDto): Promise<BillingIntentResult>;
  purchaseTokens(params: PurchaseTokensDto): Promise<BillingIntentResult>;
}
