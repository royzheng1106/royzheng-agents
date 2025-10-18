export type SourceType = 'telegram' | 'watch-app' | 'cron' | string;
export type ChannelType = 'telegram' | 'watch-app' | string;
export type MessageType = 'text' | 'image_url' | 'input_audio';

export interface SenderIdentity {
  source: SourceType;
  isBot?: boolean;
  id?: string | number;
  messageId?: string | number;
  chatId?: string | number;
  userId?: string | number;
  firstName?: string;
  lastName?: string;
  username?: string;
}

export interface RecipientIdentity {
  channel: string;
  id?: string | number;
  chatId?: string | number;
  userId?: string | number;
}

export interface ImageUrl {
  url: string;
  format: string;
}

export interface InputAudio {
  data: string;
  format: string;
}

export interface Messages {
  type: MessageType;
  text?: string;
  imageUrl?: ImageUrl;
  inputAudio?: InputAudio;
}

export interface Event<T = any> {
  id: string;
  agentId: string;
  timestamp: string;
  messages: Messages[];
  sender: SenderIdentity;
  recipients: RecipientIdentity[];
  metadata: EventMetadata;
}

export interface EventMetadata {
  placeholderMessageId?: number;
  [key: string]: any;
}