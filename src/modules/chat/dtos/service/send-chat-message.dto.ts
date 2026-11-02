export interface SendChatMessageDto {
  userId: string;
  signal: AbortSignal;
  sessionId: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  modelId?: string;
}

export interface SendChatMessageResult {
  /** Complete answer under the contract's name (`text`); `reply` is legacy. */
  text: string;
  /** Id of the ai_models row actually used (server default when unrequested). */
  modelId: string;
  reply: string;
  tokensUsed: number;
}

export interface StreamChatMessageResult {
  /** Id of the ai_models row actually used — echoed in the meta/done frames. */
  modelId: string;
  /** Plain-text fragments, in order; concatenation equals the full answer. */
  stream: AsyncGenerator<string, void, unknown>;
}
