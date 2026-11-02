import type { Mock } from 'vitest';
import type { AiModelCatalogService } from '@modules/ai';
import type { ConfigService } from '@nestjs/config';
import { QuotaExceededException } from '@exceptions/index';
import type { QuotaRepository } from '../repositories';
import type { QuotaReservation } from '../interfaces';
import { QuotaService } from './quota.service';

function reservation(overrides: Partial<QuotaReservation> = {}): QuotaReservation {
  return {
    usageId: 'usage-1',
    route: {
      id: '11111111-1111-4111-8111-111111111111',
      provider: 'gemini',
      providerModel: 'gemini-2.5-flash',
    },
    tier: 'free',
    action: 'chat',
    ...overrides,
  };
}

describe('QuotaService', () => {
  let repository: {
    reserveAiUsage: Mock;
    completeAiUsage: Mock;
    deleteReservation: Mock;
    getActivePlan: Mock;
  };
  let modelCatalog: { getTier: Mock; resolveModel: Mock };
  let config: { get: Mock };
  let service: QuotaService;

  beforeEach(() => {
    repository = {
      reserveAiUsage: vi.fn().mockResolvedValue('usage-1'),
      completeAiUsage: vi.fn().mockResolvedValue(100),
      deleteReservation: vi.fn().mockResolvedValue(undefined),
      getActivePlan: vi.fn().mockResolvedValue(null),
    };
    modelCatalog = {
      getTier: vi.fn().mockResolvedValue('free'),
      resolveModel: vi.fn().mockResolvedValue({
        record: { id: reservation().route.id },
        provider: 'gemini',
        providerModel: 'gemini-2.5-flash',
      }),
    };
    config = { get: vi.fn().mockReturnValue(undefined) };
    service = new QuotaService(
      repository as unknown as QuotaRepository,
      modelCatalog as unknown as AiModelCatalogService,
      config as unknown as ConfigService,
    );
  });

  describe('reserve', () => {
    it('reserves with the plan cap for a free user and returns the resolved route', async () => {
      modelCatalog.getTier.mockResolvedValue('free');
      repository.getActivePlan.mockResolvedValue({ ai_actions_per_day: 5, tokens_per_month: null });

      const result = await service.reserve({ userId: 'u1', action: 'generate_recipe' });

      expect(repository.reserveAiUsage).toHaveBeenCalledWith('u1', 'generate_recipe', 5);
      expect(result).toEqual<QuotaReservation>({
        usageId: 'usage-1',
        route: {
          id: '11111111-1111-4111-8111-111111111111',
          provider: 'gemini',
          providerModel: 'gemini-2.5-flash',
        },
        tier: 'free',
        action: 'generate_recipe',
      });
    });

    it('uses the configured fallback cap when the user has no active plan', async () => {
      const configured = new QuotaService(
        repository as unknown as QuotaRepository,
        modelCatalog as unknown as AiModelCatalogService,
        { get: vi.fn().mockReturnValue(12) } as unknown as ConfigService,
      );

      await configured.reserve({ userId: 'u1', action: 'chat' });

      expect(repository.reserveAiUsage).toHaveBeenCalledWith('u1', 'chat', 12);
    });

    it('defaults the fallback cap to 30 when neither plan nor config provide one', async () => {
      await service.reserve({ userId: 'u1', action: 'chat' });

      expect(repository.reserveAiUsage).toHaveBeenCalledWith('u1', 'chat', 30);
    });

    it('reserves without a daily cap for a premium user', async () => {
      modelCatalog.getTier.mockResolvedValue('premium');

      await service.reserve({ userId: 'u1', action: 'chat' });

      expect(repository.getActivePlan).not.toHaveBeenCalled();
      expect(repository.reserveAiUsage).toHaveBeenCalledWith('u1', 'chat', null);
    });

    it('passes the requested modelId through to catalog resolution', async () => {
      const modelId = '22222222-2222-4222-8222-222222222222';

      await service.reserve({ userId: 'u1', action: 'chat', modelId });

      expect(modelCatalog.resolveModel).toHaveBeenCalledWith(modelId, 'free');
    });

    it('resolves the model before reserving, so a catalog failure leaves no reservation behind', async () => {
      modelCatalog.resolveModel.mockRejectedValue(
        new Error('No AI models are configured (ai_models table is empty).'),
      );

      await expect(service.reserve({ userId: 'u1', action: 'chat' })).rejects.toThrow(
        'No AI models are configured',
      );

      expect(repository.reserveAiUsage).not.toHaveBeenCalled();
    });

    it.each([
      [
        { code: 'P0001', message: 'DAILY_CAP_REACHED' },
        'Daily AI action limit reached. Upgrade to premium for unlimited AI actions.',
      ],
      [
        { code: 'P0001', message: 'INSUFFICIENT_TOKENS' },
        'Not enough chat tokens remaining. Purchase a top-up to continue.',
      ],
    ])('maps quota signal %j to a QuotaExceededException', async (rpcError, expected) => {
      repository.reserveAiUsage.mockRejectedValue(rpcError);

      await expect(service.reserve({ userId: 'u1', action: 'chat' })).rejects.toThrow(
        new QuotaExceededException(expected),
      );
    });

    it('propagates non-quota reserve failures untouched instead of masking them as 429', async () => {
      const dbDown = { code: 'XX000', message: 'db down' };
      repository.reserveAiUsage.mockRejectedValue(dbDown);

      await expect(service.reserve({ userId: 'u1', action: 'chat' })).rejects.toEqual(dbDown);
    });
  });

  describe('complete', () => {
    it('debits the token balance for premium chat usage (cost = prompt + completion)', async () => {
      await service.complete({
        reservation: reservation({ tier: 'premium' }),
        model: 'gemini-2.5-flash',
        promptTokens: 10,
        completionTokens: 20,
      });

      expect(repository.completeAiUsage).toHaveBeenCalledWith({
        usageId: 'usage-1',
        modelId: '11111111-1111-4111-8111-111111111111',
        promptTokens: 10,
        completionTokens: 20,
        tokenCost: 30,
      });
    });

    it('charges nothing for free-tier actions', async () => {
      await service.complete({
        reservation: reservation({ tier: 'free' }),
        model: 'gemini-2.5-flash',
        promptTokens: 10,
        completionTokens: 20,
      });

      expect(repository.completeAiUsage).toHaveBeenCalledWith(
        expect.objectContaining({ tokenCost: 0 }),
      );
    });

    it('charges nothing for premium non-chat actions (only /ai/chat is token-metered)', async () => {
      await service.complete({
        reservation: reservation({ tier: 'premium', action: 'generate_recipe' }),
        model: 'gemini-2.5-flash',
        promptTokens: 10,
        completionTokens: 20,
      });

      expect(repository.completeAiUsage).toHaveBeenCalledWith(
        expect.objectContaining({ tokenCost: 0 }),
      );
    });

    it('translates an INSUFFICIENT_TOKENS completion failure into a QuotaExceededException', async () => {
      repository.completeAiUsage.mockRejectedValue({
        code: 'P0001',
        message: 'INSUFFICIENT_TOKENS: balance 5 < cost 30',
      });

      await expect(
        service.complete({
          reservation: reservation({ tier: 'premium' }),
          model: 'm',
          promptTokens: 1,
          completionTokens: 1,
        }),
      ).rejects.toThrow(
        new QuotaExceededException(
          'Not enough chat tokens remaining. Purchase a top-up to continue.',
        ),
      );
    });

    it('rethrows unrelated completion failures untouched', async () => {
      repository.completeAiUsage.mockRejectedValue({ code: 'XX000', message: 'db down' });

      await expect(
        service.complete({
          reservation: reservation(),
          model: 'm',
          promptTokens: 1,
          completionTokens: 1,
        }),
      ).rejects.toEqual({ code: 'XX000', message: 'db down' });
    });
  });

  describe('release', () => {
    it('deletes the reservation row', async () => {
      await service.release(reservation({ usageId: 'usage-9' }));

      expect(repository.deleteReservation).toHaveBeenCalledWith('usage-9');
    });
  });
});
