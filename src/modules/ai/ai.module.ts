import { Module } from '@nestjs/common';
import { AiModelsController } from './controllers';
import { GeminiStrategy, OllamaStrategy, OpenAiStrategy } from './providers';
import { AiStrategyRegistry } from './registries';
import { AiService } from './services';
import { AiJsonService, AiModelCatalogService } from './services';
import {
  AI_PROVIDER_STRATEGIES_TOKEN,
  AI_SERVICE_TOKEN,
  AI_STRATEGY_REGISTRY_TOKEN,
} from './constants';
import { AiProviderStrategy } from './contracts';

@Module({
  controllers: [AiModelsController],
  providers: [
    GeminiStrategy,
    OllamaStrategy,
    OpenAiStrategy,
    AiStrategyRegistry,
    AiModelCatalogService,
    AiJsonService,
    AiService,
    {
      provide: AI_STRATEGY_REGISTRY_TOKEN,
      useExisting: AiStrategyRegistry,
    },
    {
      provide: AI_SERVICE_TOKEN,
      useExisting: AiService,
    },
    {
      provide: AI_PROVIDER_STRATEGIES_TOKEN,
      useFactory: (...strategies: AiProviderStrategy[]) => strategies,
      inject: [GeminiStrategy, OllamaStrategy, OpenAiStrategy],
    },
  ],
  exports: [AI_SERVICE_TOKEN, AiModelCatalogService, AiJsonService],
})
export class AiModule {}
