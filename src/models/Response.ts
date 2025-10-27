export type IntegrationType = 'telegram' | 'watch-app' | string;
export type MessageType = 'text' | 'audio';

export interface ResponseMessage {
  type: MessageType;
  text?: string;
  audio?: ResponseAudio;
  placeholder_message_id?: number;
  options?: Options;
}

export interface ResponseAudio {
  data: string;
  format: string;
}

export interface Options {
  parseMode?: string;
}

export interface ResponseRecipient {
  channel: IntegrationType;      // which integration/channel to send to
  id?: string | number;
  user_id?: string | number;      // user ID from the event
  chat_id?: string | number;
  message_id?: string | number;
}

export interface Response {
  id?: string;                     // event ID
  recipients?: ResponseRecipient[]; // array of recipients
  messages: ResponseMessage[];
  metadata?: Record<string, any>;  // e.g., agent_id, source info
}
