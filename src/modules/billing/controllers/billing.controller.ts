import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import { GetCurrentUser } from '@common/decorators/request';
import { SupabaseAuthGuard } from '@modules/auth';
import { BILLING_SERVICE_TOKEN } from '../constants';
import { PurchaseTokensBodyDto, SubscribeBodyDto } from '../dtos';
import type { IBillingService } from '../interfaces';

@UseGuards(SupabaseAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(
    @Inject(BILLING_SERVICE_TOKEN)
    private readonly billingService: IBillingService,
  ) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.ACCEPTED)
  async subscribe(@Body() body: SubscribeBodyDto, @GetCurrentUser() user: AuthUser) {
    return this.billingService.subscribe({ userId: user.id, planId: body.planId });
  }

  @Post('tokens')
  @HttpCode(HttpStatus.ACCEPTED)
  async purchaseTokens(@Body() body: PurchaseTokensBodyDto, @GetCurrentUser() user: AuthUser) {
    return this.billingService.purchaseTokens({ userId: user.id, tokens: body.tokens });
  }
}
