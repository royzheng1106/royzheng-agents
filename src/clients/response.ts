import type { Event } from '../models/Event.js';
import type { Response, ResponseRecipient, ResponseMessage } from '../models/Response.js';
import { CONFIG } from '../utils/config.js';

/**
 * Send one or multiple messages to the integration endpoint.
 * - Each message can be text, audio, or both.
 * - includePlaceholder: include placeholder_message_id in the first message (if it exists)
 */
export async function sendResponse(
  event: Event,
  messages: ResponseMessage | ResponseMessage[],
  options?: { includePlaceholder?: boolean }
) {
  // Normalize to array
  const msgs: ResponseMessage[] = Array.isArray(messages) ? messages : [messages];

  // Add placeholder_message_id to the first message if required
  if (options?.includePlaceholder && event.metadata?.placeholder_message_id != null) {
    msgs[0].placeholder_message_id = event.metadata.placeholder_message_id;
  }

  const payload: Response = {
    id: event.id,
    recipients: (event.recipients || []).map((r: any): ResponseRecipient => ({
      channel: r.channel,
      id: r.id ?? undefined,
      user_id: r.user_id ?? undefined,
      chat_id: r.chat_id ?? undefined,
    })),
    messages: msgs,
    metadata: {
      source: event.sender?.source,
      agent_id: event.agent_id,
    },
  };

  console.log('Sending payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await fetch('https://royzheng-integrations-lb.hf.space/api/send-response', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONFIG.INT_API_KEY!,
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
 * - includePlaceholder: include placeholder_message_id in the first message if present
 */
export async function sendBackgroundMessage(
  event: Event,
  content: string,
  options?: { includePlaceholder?: boolean }
) {
  const formatted = `_${content}_`; // always italic

  const message: any = { type: 'text', content: formatted };
  if (options?.includePlaceholder && event.metadata?.placeholder_message_id != null) {
    message.placeholder_message_id = event.metadata.placeholder_message_id;
  }

  const payload: Response = {
    id: event.id,
    recipients: (event.recipients || []).map((r: any): ResponseRecipient => ({
      channel: r.channel,
      id: r.id ?? undefined,
      user_id: r.user_id ?? undefined,
      chat_id: r.chat_id ?? undefined,
    })),
    messages: [message],
    metadata: {
      source: event.sender?.source,
      agent_id: event.agent_id,
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
