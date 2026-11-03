import { AiActionType, AiModelRoute } from '../../ai';

export interface QuotaReservation {
  usageId: string;
  route: AiModelRoute;
  tier: 'free' | 'premium';
  /** Action the reservation was opened for — only chat is token-metered. */
  action: AiActionType;
}

export type QuotaAction = AiActionType;

export interface IQuotaService {
  /**
   * Phase 1 of the quota lifecycle: reserves a slot (or debits nothing yet)
   * and resolves the model route to call. Throws QuotaExceededException when
   * the free daily cap is exhausted.
   */
  reserve(params: {
    userId: string;
    action: QuotaAction;
    modelId?: string;
  }): Promise<QuotaReservation>;

  /**
   * Phase 2: completes the reservation with real token counts and debits the
   * token balance for premium chat usage.
   */
  complete(params: {
    reservation: QuotaReservation;
    model: string;
    promptTokens: number;
    completionTokens: number;
  }): Promise<void>;

  /** Deletes an abandoned reservation after a provider failure. */
  release(reservation: QuotaReservation): Promise<void>;
}
