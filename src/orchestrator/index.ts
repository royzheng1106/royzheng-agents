import type { Event } from '../models/Event.js';
import { v4 as uuidv4 } from 'uuid';
import { AgentFactory } from '../agents/factory/index.js';
import { Content, ToolMessage, AssistantMessage, UserMessage, Conversation, Message, LLMClient } from '../clients/llm.js';
import { tursoClient } from '../clients/turso.js';
import { parseMessage } from '../utils/messageParser.js';
import { sendResponse } from '../clients/response.js';
import { MCPClient } from "../clients/mcp.js";
import { CONFIG } from "../utils/config.js"
import { sanitizeResponseMessage } from '../utils/sanitiseResponseMessage.js';
import type { OutgoingMessage } from '../models/Response.js';


interface UntypedDbRow {
  message: string;
  [key: string]: any;
}

function normalizeMessages(messages: Content[]): Content[] {
  return messages.map((m) => {
    const normalized: Content = { ...m };

    // Normalize field names to snake_case
    if ((m as any).imageUrl) {
      normalized.image_url = (m as any).imageUrl;
      delete (normalized as any).imageUrl;
    }

    if ((m as any).inputAudio) {
      normalized.input_audio = (m as any).inputAudio;
      delete (normalized as any).inputAudio;
    }

    return normalized;
  });
}

export class Orchestrator {
  private llm: LLMClient;
  private mcpClient: MCPClient;

  constructor(private agentFactory: AgentFactory) {
    this.llm = new LLMClient();
    this.mcpClient = new MCPClient(
      'https://royzheng-core.vercel.app/api/mcp',
      CONFIG.MCP_API_KEY!
    );
  }

  public async handleEvent(event: Event) {
    if (!event.messages) throw new Error('Event missing messages');

    const userId = event.sender?.userId != null ? String(event.sender.userId) : undefined;
    const chatId = event.sender?.chatId != null ? String(event.sender.chatId) : undefined;
    const placeholderMessageId = event.metadata?.placeholderMessageId ?? null;

    if (!event.agentId) throw new Error('No agent specified');
    let agentId = event.agentId;
    let agentIdOverwritten: boolean = false;
    let hasAudioInput: boolean = false;
    let sessionId: string = uuidv4();
    let sessionCommand: string | null = null;
    const conversation: Conversation = [];

    for (const message of event.messages) {
      const messageType = message.type;

      if (messageType == "text") {
        if (!message.text) throw new Error('Text Event missing text');
        // --- Parse Message ---
        const { cleanText, sessionCommand: sCommandValue, agentIdOverride: aIdOverwrite } = parseMessage(message.text);
        message.text = cleanText;
        sessionCommand = sCommandValue || sessionCommand;
        if (aIdOverwrite) {
          console.log(`Agent Overwritten - Default: ${agentId}, New: ${aIdOverwrite}`)
          agentId = aIdOverwrite;
          agentIdOverwritten = true; // Set flag to true if an override occurred
        }
      } else if (messageType == "input_audio") {
        hasAudioInput = true;
      }
    }

    // --- Setup Agent ---
    const agent = await this.agentFactory.get(agentId);
    if (!agent) throw new Error(`No agent found for id ${agentId}`);

    const { model = 'gemini-2.5-flash', systemPrompt = '' } = agent.config;
    if (userId) {
      switch (sessionCommand) {
        case 'new':
          console.log("Session command: NEW. Starting a fresh session.");
          const systemMessage: Message = {
            role: 'system',
            content: systemPrompt,
          };
          await tursoClient.logConversation({
            model,
            role: 'system',
            message: JSON.stringify(systemMessage),
            user_id: userId,
            chat_id: chatId,
            session_id: sessionId,
            agent_id: agentId,
          });

          conversation.push(systemMessage);
          break;
        case undefined:
        // Fall-through: This case has no 'break;', so the execution falls directly
        default:
          console.log("Session command: None.");

          const rows = await tursoClient.getLatestConversation(userId);

          for (const r of rows) {
            const dbRow = r as unknown as UntypedDbRow;

            try {
              if (typeof dbRow.message === 'string') {
                const messageObject: Message = JSON.parse(dbRow.message);

                conversation.push(messageObject);
              } else {
                console.warn('Row found without a valid "message" string property.');
              }
            } catch (error) {
              console.error('Failed to parse message from database.', error, 'Row:', dbRow);
            }
          }
          if (agentIdOverwritten) {
            const systemMessage: Message = {
              role: 'system',
              content: systemPrompt,
            };
            await tursoClient.logConversation({
              model,
              role: 'system',
              message: JSON.stringify(systemMessage),
              user_id: userId,
              chat_id: chatId,
              session_id: sessionId,
              agent_id: agentId,
            });

            conversation.push(systemMessage);
          }
      }
    }
    else {
      // Not User: always new session
      const systemMessage: Message = {
        role: 'system',
        content: systemPrompt,
      };
      await tursoClient.logConversation({
        model,
        role: 'system',
        message: JSON.stringify(systemMessage),
        user_id: userId,
        chat_id: chatId,
        session_id: sessionId,
        agent_id: agentId,
      });

      conversation.push(systemMessage);
    }
    const userMessage: UserMessage = {
      role: 'user',
      content: normalizeMessages(event.messages),
    };

    await tursoClient.logConversation({
      model,
      role: 'system',
      message: JSON.stringify(userMessage),
      user_id: userId,
      chat_id: chatId,
      session_id: sessionId,
      agent_id: agentId,
    });
    conversation.push(userMessage);

    // --- LLM loop ---
    let finalAssistantText = '';
    let firstOutgoingMessageSent = false;

    // Fetch MCP tools
    const llmTools = await this.mcpClient.listTools();

    while (true) {
      const response: any = await this.llm.sendConversation(model, conversation, llmTools);

      const choice = response?.choices?.[0];
      const responseMessageRaw = choice.message;
      const sanitizedMessage = sanitizeResponseMessage(responseMessageRaw);
      const responseMessage: AssistantMessage = sanitizedMessage as AssistantMessage;

      console.log("Sanitised LLM Response:\n", responseMessage)

      const finishReason = choice.finish_reason;

      const usage = response?.usage;
      const completionTokens = usage.completion_tokens;
      const promptTokens = usage.prompt_tokens;
      const totalTokens = usage.total_tokens;

      const logData = {
        model,
        role: responseMessage.role,
        message: JSON.stringify(responseMessage),
        finish_reason: finishReason,
        user_id: userId,
        chat_id: chatId,
        session_id: sessionId,
        agent_id: agentId,
        completion_tokens: completionTokens,
        prompt_tokens: promptTokens,
        total_tokens: totalTokens
      };

      await tursoClient.logConversation(logData);
      console.log("Saved assistant response to Database")

      conversation.push(responseMessage);

      const toolCalls = (responseMessage as AssistantMessage).tool_calls ?? [];
      console.log(`🧠 Detected ${toolCalls.length} tool call(s)`);

      if (toolCalls.length > 0) {

        await sendResponse(
          event,
          {
            type: 'text',
            content: `🛠 Resolving ${toolCalls.length} tool call(s)`,
            // placeholderMessageId will be automatically added if includePlaceholder is true
          },
          {
            includePlaceholder: !!event.metadata.placeholderMessageId,
          }
        );

        for (const call of toolCalls) {
          const { id: tool_call_id, function: fn } = call;
          const { name, arguments: argsRaw } = fn;

          // Safely parse arguments
          let parsedArgs: Record<string, any> = {};
          try {
            parsedArgs = JSON.parse(argsRaw || '{}');
          } catch (err) {
            console.error(`❌ Failed to parse tool arguments for ${name}:`, argsRaw);
          }

          // --- Call MCP Tool ---
          let toolResult: any;
          try {
            toolResult = await this.mcpClient.callTool({
              name,
              arguments: parsedArgs,
            });
            console.log(`🧰 Tool '${name}' executed successfully`, toolResult);
          } catch (err) {
            console.error(`❌ Tool '${name}' failed:`, err);
            toolResult = { error: String(err) };
          }

          // --- Build Tool Message ---
          const toolMessage: ToolMessage = {
            role: 'tool',
            content: JSON.stringify(toolResult),
            tool_call_id,
          };

          // --- Log into DB ---
          await tursoClient.logConversation({
            model,
            role: 'tool',
            message: JSON.stringify(toolMessage),
            user_id: userId,
            chat_id: chatId,
            session_id: sessionId,
            agent_id: agentId,
          });

          console.log(`🗃️ Logged tool result for '${name}'`);

          conversation.push(toolMessage);
        }
        continue;
      }
      // --- Final assistant text ---
      else if (finishReason === 'stop' && responseMessage.content !== null) {
        finalAssistantText = responseMessage.content;

        const outgoingMessages: OutgoingMessage[] = [
          { type: 'text', content: finalAssistantText }
        ];

        if (hasAudioInput) {
          try {
            const voice = agent.config.geminiVoice;
            const ttsResponse: any = await this.llm.textToAudio(finalAssistantText, undefined, voice);

            const choice = ttsResponse.choices?.[0];
            const audioData = choice?.message?.audio?.data;
            const audioFormat = choice?.message?.audio?.format || 'mp3';

            if (!audioData) throw new Error('[Orchestrator] TTS response missing audio data');

            outgoingMessages.push({
              type: 'audio',
              audio: { data: audioData, format: audioFormat }
            });
          } catch (err) {
            console.error('❌ TTS failed, sending text only:', err);
          }
        }

        // Send whatever messages we have (text + optional audio)
        await sendResponse(event, outgoingMessages, {
          includePlaceholder: !firstOutgoingMessageSent && placeholderMessageId != null
        });

        firstOutgoingMessageSent = true;
        break;
      }
    }
  }
}