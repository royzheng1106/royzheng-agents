import type { Event } from '../models/Event.js';
import type { Response, OutgoingRecipient, OutgoingMessage } from '../models/Response.js';
import { CONFIG } from '../utils/config.js';

/**
 * Send one or multiple messages to the integration endpoint.
 * - Each message can be text, audio, or both.
 * - includePlaceholder: include placeholderMessageId in the first message (if it exists)
 */
export async function sendResponse(
  event: Event,
  messages: OutgoingMessage | OutgoingMessage[],
  options?: { includePlaceholder?: boolean }
) {
  // Normalize to array
  const msgs: OutgoingMessage[] = Array.isArray(messages) ? messages : [messages];

  // Add placeholderMessageId to the first message if required
  if (options?.includePlaceholder && event.metadata?.placeholderMessageId != null) {
    msgs[0].placeholderMessageId = event.metadata.placeholderMessageId;
  }

  const payload: Response = {
    id: event.id,
    recipients: (event.recipients || []).map((r: any): OutgoingRecipient => ({
      channel: r.channel,
      id: r.id ?? undefined,
      userId: r.userId ?? undefined,
      chatId: r.chatId ?? undefined,
    })),
    messages: msgs,
    metadata: {
      source: event.sender?.source,
      agentId: event.agentId,
    },
  };

  console.log('Sending payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await fetch('https://royzheng-integrations.vercel.app/api/send-response', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.INT_API_KEY!,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`❌ Failed to send response: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error('❌ Network error while sending response:', err);
  }
}

/**
 * Send a background (intermediate/tool) message.
 * - Always italicized
 * - includePlaceholder: include placeholderMessageId in the first message if present
 */
export async function sendBackgroundMessage(
  event: Event,
  content: string,
  options?: { includePlaceholder?: boolean }
) {
  const formatted = `_${content}_`; // always italic

  const message: any = { type: 'text', content: formatted };
  if (options?.includePlaceholder && event.metadata?.placeholderMessageId != null) {
    message.placeholderMessageId = event.metadata.placeholderMessageId;
  }

  const payload: Response = {
    id: event.id,
    recipients: (event.recipients || []).map((r: any): OutgoingRecipient => ({
      channel: r.channel,
      id: r.id ?? undefined,
      userId: r.userId ?? undefined,
      chatId: r.chatId ?? undefined,
    })),
    messages: [message],
    metadata: {
      source: event.sender?.source,
      agentId: event.agentId,
    },
  };
  console.log(JSON.stringify(payload));
  try {
    const res = await fetch('https://royzheng-integrations.vercel.app/api/send-response', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.INT_API_KEY!,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) console.error(`❌ Failed to send background message: ${res.statusText}`);
  } catch (err) {
    console.error('❌ Network error while sending background message:', err);
  }
}
