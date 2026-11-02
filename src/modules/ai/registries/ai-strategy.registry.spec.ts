import { BadRequestException } from '@nestjs/common';
import { AiProviderStrategy } from '../contracts';
import { AiProviderType } from '../types';
import { AiStrategyRegistry } from './ai-strategy.registry';

function fakeStrategy(providerId: string): AiProviderStrategy {
  return {
    providerId,
    generateChat: vi.fn(),
    // eslint-disable-next-line require-yield
    generateStream: async function* () {
      throw new Error('not implemented');
    },
  } as unknown as AiProviderStrategy;
}

describe('AiStrategyRegistry', () => {
  const openai = fakeStrategy('openai');
  const gemini = fakeStrategy('gemini');
  let registry: AiStrategyRegistry;

  beforeEach(() => {
    registry = new AiStrategyRegistry([openai, gemini]);
  });

  it('returns the registered strategy for a known provider', () => {
    expect(registry.get('openai')).toBe(openai);
    expect(registry.get('gemini')).toBe(gemini);
  });

  it('returns undefined for an unknown provider', () => {
    expect(registry.get('mistral' as AiProviderType)).toBeUndefined();
  });

  it('getOrThrow returns the strategy when registered', () => {
    expect(registry.getOrThrow('openai')).toBe(openai);
  });

  it('getOrThrow names the missing provider and lists the active engines', () => {
    expect(() => registry.getOrThrow('ollama' as AiProviderType)).toThrow(
      new BadRequestException(
        'AI Engine "ollama" is unavailable. Active engines: [openai, gemini]',
      ),
    );
  });

  it('keeps the last strategy when two strategies claim the same provider id', () => {
    const duplicate = fakeStrategy('openai');
    const collisionRegistry = new AiStrategyRegistry([openai, duplicate]);

    expect(collisionRegistry.get('openai')).toBe(duplicate);
  });
});
