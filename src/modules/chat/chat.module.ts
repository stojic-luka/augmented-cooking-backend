import { Module } from '@nestjs/common';
import { AiModule } from '../ai';
import { QuotaModule } from '../quota';
import { ChatController } from './controllers';
import { CHAT_SERVICE_TOKEN } from './constants';
import { ChatService } from './services';

@Module({
  imports: [AiModule, QuotaModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: CHAT_SERVICE_TOKEN,
      useExisting: ChatService,
    },
  ],
  exports: [CHAT_SERVICE_TOKEN],
})
export class ChatModule {}
