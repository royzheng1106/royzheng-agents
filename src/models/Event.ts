export type Source = 'telegram' | 'watch-app' | 'cron' | string;
export type Channel = 'telegram' | 'watch-app' | string;
export type MessageType = 'text' | 'image' | 'audio';

export interface EventSender {
  source?: Source;
  is_bot?: boolean;
  id?: string | number;
  // -- Telegram -- 
  message_id?: string | number; 
  chat_id?: string | number;
  user_id?: string | number;
  first_name?: string;
  last_name?: string;
  username?: string;

  agent_id?: string;
}

export interface EventRecipient {
  channel: string;
  id?: string | number;
  chat_id?: string | number;
  user_id?: string | number;
}

export interface Image {
  url: string;
  format: string;
}

export interface Audio {
  data: string;
  format: string;
}

export interface EventMessage {
  type: MessageType;
  text?: string;
  image?: Image;
  audio?: Audio;
}

export interface Event<T = any> {
  id: string;
  agent_id: string;
  timestamp: string;
  messages: EventMessage[];
  sender?: EventSender;
  recipients?: EventRecipient[];
  metadata: EventMetadata;
}

export interface EventMetadata {
  placeholder_message_id?: number;
  agent_id?: string;
  sessionId?: string;
  [key: string]: any;
}