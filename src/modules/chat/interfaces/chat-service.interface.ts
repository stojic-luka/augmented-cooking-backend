import type {
  SendChatMessageDto,
  SendChatMessageResult,
  StreamChatMessageResult,
} from '../dtos';

export interface IChatService {
  sendMessage(params: SendChatMessageDto): Promise<SendChatMessageResult>;

  /**
   * Reserves quota and resolves the model, then exposes the answer as an
   * async generator of text fragments. Quota is completed after the last
   * fragment and released on any failure (including client aborts). Errors
   * thrown before the first fragment are pre-stream failures.
   */
  streamChat(params: SendChatMessageDto): Promise<StreamChatMessageResult>;
}
