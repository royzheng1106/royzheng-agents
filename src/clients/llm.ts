import { CONFIG } from "../utils/config.js";
import { getCurrentDateTimeSG } from "../utils/getCurrentDateTimeSG.js"; // 👈 import your util


/**
 * Message Types
 */
export type MessageType = "text" | "image_url" | "input_audio";

/**
 * Ensure API key is available at startup
 */
if (!CONFIG.LLM_API_KEY) {
  throw new Error("LLM_API_KEY environment variable is not set");
}

/**
 * LLMClient — handles communication with your LiteLLM proxy.
 */
export class LLMClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(
    baseUrl = "https://royzheng-llm-lb.hf.space",
    apiKey: string = CONFIG.LLM_API_KEY!
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  /**
   * Send a full conversation to LiteLLM.
   * Returns the full JSON response from the model.
   */
  async getLLMResponse(
    { model, conversation, tools }: {
      model: string;
      conversation: Conversation;
      tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, any>;
      }>;
    }
  ): Promise<any> {
    const nowString = getCurrentDateTimeSG();
    const timeSystemMessage: SystemMessage = {
      role: "system",
      content: [
        { type: "text", text: `Current time in Singapore: ${nowString}` }
      ],
    };

    const conversationWithTime = [...conversation, timeSystemMessage];
    const payload: Record<string, any> = { model, messages: conversationWithTime };

    if (tools?.length) {
      payload.tools = tools;
      console.log(`[LLMClient] Including ${tools.length} tools`);
    }

    const maxRetries = 3;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < maxRetries) {
      attempt++;
      try {
        console.log(`[LLMClient] Attempt ${attempt}/${maxRetries} → sending request to ${this.baseUrl}/chat/completions`);

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.apiKey,
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`[LLMClient] Request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // ✅ Verify response validity
        if (!data?.choices?.length || !data.choices[0]?.message) {
          throw new Error(`[LLMClient] Invalid LLM response: ${JSON.stringify(data)}`);
        }

        // ✅ Success → return result
        return data;

      } catch (err: any) {
        lastError = err;
        console.warn(`⚠️ [LLMClient] Attempt ${attempt} failed: ${err.message}`);

        // Exponential backoff delay before retry
        const delayMs = 500 * Math.pow(2, attempt - 1);
        await new Promise(res => setTimeout(res, delayMs));
      }
    }

    // ❌ After max retries, throw
    console.error(`[LLMClient] All ${maxRetries} attempts failed.`);
    throw lastError || new Error("LLM request failed after retries");
  }

  /**
 * Convert audio input to text using LiteLLM.
 * @param audioData - Base64-encoded audio string
 * @param format - Audio format (e.g., "ogg", "mp3")
 * @param model - Model to use for transcription (default: "gemini-2.5-flash-lite")
 * @returns A Promise containing the transcription result from LiteLLM
 */
  async audioToText(
    audioData: string,
    format: string = "ogg",
    model: string = "gemini-2.5-flash-lite"
  ): Promise<string> {
    const payload = {
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please provide a complete transcription of the speech in this audio clip."
            },
            {
              type: "input_audio",
              input_audio: {
                data: audioData,
                format
              }
            }
          ]
        }
      ]
    };

    console.log(`[LLMClient] Sending audio for transcription to LiteLLM: ${model}`);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Audio transcription request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data?.choices?.[0];
    const message = choice?.message;

    if (!message?.content) return "";

    return message.content;
  }

  /**
 * Convert text to audio using the LiteLLM proxy.
 * @param text - The text to be converted into speech.
 * @param model - The speech model (default: "gemini-2.5-flash-preview-tts").
 * @param voice - The voice to use for synthesis (default: "Sulafat").
 * @param format - Output audio format (default: "mp3").
 * @returns A Promise containing the audio file as an ArrayBuffer or base64 string (depending on your API).
 */
  async textToAudio(
    text: string,
    model: string = "gemini-2.5-flash-preview-tts",
    voice: string = "Sulafat",
    format: string = "mp3"
  ): Promise<any> {
    const payload = {
      model,
      messages: [
        {
          role: "user",
          content: text
        }
      ],
      modalities: ["audio"],
      audio: { voice, format }
    };

    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + this.apiKey,
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`TTS request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }
}



/* -------------------------------------------------------------------------- */
/*                              Type Definitions                              */
/* -------------------------------------------------------------------------- */

/**
 * Tool Calls
 */
interface FunctionArguments {
  [key: string]: any;
}

interface ToolCall {
  id: string;
  index: number;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Thinking Blocks (for models that expose reasoning)
 */
interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

/**
 * Tool Message (Role: 'tool')
 */
export interface ToolMessage {
  role: "tool";
  content: string; // Tool/function result
  tool_call_id: string; // Corresponding ToolCall ID
}

/**
 * Assistant Message (Role: 'assistant')
 */
export interface AssistantMessage {
  role: "assistant";
  content: string | null; // Text or null if tool-only
  tool_calls?: ToolCall[];
  function_call?: any; // Deprecated format
  images?: any[];
  thinking_blocks?: ThinkingBlock[];
}

/**
 * System Message (Role: 'system')
 */
export interface SystemMessage {
  role: "system";
  content: Content[];
}

/**
 * User Message (Role: 'user')
 */
export interface UserMessage {
  role: "user";
  content: Content[];
}

/**
 * Supported message parts
 */
export interface Content {
  type: MessageType;
  text?: string;
  image_url?: ImageUrl;
  input_audio?: InputAudio;
}

export interface ImageUrl {
  url: string;
  format: string;
}

export interface InputAudio {
  data: string;
  format: string;
}

/* -------------------------------------------------------------------------- */
/*                             Conversation Types                             */
/* -------------------------------------------------------------------------- */

export type Message =
  | SystemMessage
  | UserMessage
  | ToolMessage
  | AssistantMessage;

export type Conversation = Message[];

export type Role = "user" | "assistant" | "system" | "tool";
