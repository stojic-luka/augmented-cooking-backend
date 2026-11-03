import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import { SupabaseAuthGuard } from '../../auth';
import { GetCurrentUser } from '../../../common/decorators/request';
import { AiModelsResponse } from '../ai.models';
import { AiModelCatalogService } from '../services';

@UseGuards(SupabaseAuthGuard)
@Controller('ai')
export class AiModelsController {
  constructor(private readonly modelCatalog: AiModelCatalogService) {}

  @Get('models')
  async listModels(@GetCurrentUser() user: AuthUser): Promise<AiModelsResponse> {
    const tier = await this.modelCatalog.getTier(user.id);
    return this.modelCatalog.listForTier(tier);
  }
}
