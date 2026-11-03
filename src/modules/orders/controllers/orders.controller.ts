import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '@supabase/supabase-js';
import { GetCurrentUser } from '../../../common/decorators/request';
import { SupabaseAuthGuard } from '../../auth';
import { ORDERS_SERVICE_TOKEN } from '../constants';
import { CreateOrderBodyDto } from '../dtos';
import type { IOrdersService } from '../interfaces';

@UseGuards(SupabaseAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(ORDERS_SERVICE_TOKEN)
    private readonly ordersService: IOrdersService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() body: CreateOrderBodyDto, @GetCurrentUser() user: AuthUser) {
    const { orderId, status } = await this.ordersService.createOrder({
      userId: user.id,
      shoppingListId: body.shoppingListId,
      items: body.items.map((item) => ({
        name: item.name,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
      })),
    });

    return { orderId, status };
  }
}
