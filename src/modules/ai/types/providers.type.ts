export type AiProviderType = 'openai' | 'gemini' | 'ollama' | (string & {});

interface ResponseSchema {
  title: string;
  schema: Record<string, unknown>;
}

export interface AiRequestOptions {
  userId: string;
  requestId: string;
  /** Provider strategy id (openai | gemini | ollama); module default when omitted. */
  provider?: string;
  /** Concrete model name at the provider; the strategy default when omitted. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal: AbortSignal;
  responseSchema?: ResponseSchema;
}

//
export interface ChatMessage {
  role: MessageRoles;
  content: string;
}

// export interface MetadataStreamChunk extends AiBaseStreamChunk {
//   type: 'metadata';
//   model?: string;
//   finishReason?: 'stop' | 'length' | 'content_filter' | null;
//   usage?: {
//     promptTokens: number;
//     completionTokens: number;
//     totalTokens: number;
//   };
// }

export type ResponseTypes = 'COMPLETE' | 'STREAMED_METADATA' | 'STREAMED_TEXT' | 'STREAMED_IMAGE';
export type MessageRoles = 'system' | 'user' | 'assistant' | 'tool' | (string & {});

interface AiResponse {
  requestId: string;
  type: ResponseTypes;
}

interface AiImageResponse {
  url: string;
  alt: string;
}

interface AiMetadataResponse {
  userId: string;
  model: string;
  role: MessageRoles;
  timestamp: number;
  userMessageId: string;
  aiMessageId: string;
}

//
// Complete Response
//
interface AiCompleteResponseContent {
  text: string;
  images: AiImageResponse[];
}

/** Token accounting as reported by the provider (missing keys default to 0). */
export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiCompleteResponse extends AiResponse {
  type: 'COMPLETE';
  content: AiCompleteResponseContent;
  metadata: AiMetadataResponse;
  usage: AiTokenUsage;
}

//
// Streaming Response
//
interface AiBaseStreamChunk<T> extends AiResponse {
  sequence: number;
  lastChunk: boolean;
  content: T;
}

interface AiTextStreamChunk extends AiBaseStreamChunk<string> {
  type: 'STREAMED_TEXT';
}
interface AiMetadataStreamChunk extends AiBaseStreamChunk<AiMetadataResponse> {
  type: 'STREAMED_METADATA';
}
interface AiImageStreamChunk extends AiBaseStreamChunk<AiImageResponse> {
  type: 'STREAMED_IMAGE';
}

export type AiStreamChunk = AiTextStreamChunk | AiMetadataStreamChunk | AiImageStreamChunk;
