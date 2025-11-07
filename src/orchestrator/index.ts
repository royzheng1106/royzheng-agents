import type { Event } from '../models/Event.js';
import { v4 as uuidv4 } from 'uuid';
import { AgentFactory } from '../agents/factory/index.js';
import { Content, ToolMessage, SystemMessage, AssistantMessage, UserMessage, Conversation, Message, LLMClient } from '../clients/llm.js';
import { tursoClient } from '../clients/turso.js';
import { parseMessage } from '../utils/messageParser.js';
import { sendResponse } from '../clients/response.js';
import { MCPClient } from "../clients/mcp.js";
import { CONFIG } from "../utils/config.js"
import { sanitizeResponseMessage } from '../utils/sanitiseResponseMessage.js';
import type { ResponseMessage } from '../models/Response.js';
import { sendGraphitiEpisode, searchGraphiti } from "../clients/graphiti.js";

const THRESHOLD_HOURS: number = 3;

interface UntypedDbRow {
  message: string;
  [key: string]: any;
}

export function convertEventToUserMessage(event: Event): UserMessage {
  const content: Content[] = [];

  const location = event.metadata?.location;
  if (location?.geocode_information) {
    const locationText = `I am currently at:\n${location.geocode_information}`;
    content.push({
      type: "text",
      text: locationText,
    });
  }

  for (const msg of event.messages) {
    // Add text if non-empty
    if (msg.text?.trim()) {
      content.push({
        type: "text",
        text: msg.text,
      });
    }

    // Add image if present and valid
    if (msg.image?.url?.trim()) {
      content.push({
        type: "image_url",
        image_url: {
          url: msg.image.url,
          format: msg.image.format,
        },
      });
    }

    // Add audio if present and valid
    if (msg.audio?.data?.trim()) {
      content.push({
        type: "input_audio",
        input_audio: {
          data: msg.audio.data,
          format: msg.audio.format,
        },
      });
    }
  }

  return {
    role: "user",
    content,
  };
}


export class Orchestrator {
  private llm: LLMClient;
  private mcpClient: MCPClient;

  constructor(private agentFactory: AgentFactory) {
    this.llm = new LLMClient();

    let baseUrlCore = "https://royzheng-core.hf.space";

    this.mcpClient = new MCPClient(
      `${baseUrlCore}/api/mcp`,
      CONFIG.MCP_API_KEY!
    );
  }

  public async handleEvent(event: Event) {
    if (!event.messages) throw new Error('Event missing messages');

    let agent_idOverwritten: boolean = false;
    let hasAudioInput: boolean = false; // Determines if an audio output is required
    let sessionCommand: string | null = null;
    const conversation: Conversation = [];

    // -- Unpack Event --
    // 1. Sender
    if (!event.agent_id) throw new Error('No agent specified');
    let agent_id = event.agent_id;

    // 2. Sender
    const source = event.sender?.source != null ? String(event.sender.source) : undefined;
    const is_bot = event.sender?.source != null ? Boolean(event.sender.is_bot) : undefined;
    const id = event.sender?.id != null ? String(event.sender.id) : undefined;
    const message_id = event.sender?.message_id != null ? String(event.sender.message_id) : undefined;
    const user_id = event.sender?.user_id != null ? String(event.sender.user_id) : undefined;
    const chat_id = event.sender?.chat_id != null ? String(event.sender.chat_id) : undefined;
    const first_name = event.sender?.first_name != null ? String(event.sender.first_name) : undefined;
    const last_name = event.sender?.last_name != null ? String(event.sender.last_name) : undefined;
    const username = event.sender?.username != null ? String(event.sender.username) : undefined;

    // 2. Metadata
    const placeholder_message_id = event.metadata?.placeholder_message_id != null ? Number(event.metadata?.placeholder_message_id) : undefined;
    let sessionId = event.metadata?.sessionId != null ? String(event.metadata?.sessionId) : undefined;

    // 3. Messages
    for (const message of event.messages) {
      const messageType = message.type;

      if (messageType == "text") {
        if (!message.text) throw new Error('Text Event missing text');
        // --- Parse Message ---
        const { cleanText, sessionCommand: sessionCommandValue, agent_idOverride: aIdOverwrite } = parseMessage(message.text);
        message.text = cleanText;
        sessionCommand = sessionCommandValue || sessionCommand;
        if (aIdOverwrite) {
          console.log(`Agent Overwritten - Default: ${agent_id}, New: ${aIdOverwrite}`)
          agent_id = aIdOverwrite;
          agent_idOverwritten = true; // Set flag to true if an override occurred
        }
      } else if (messageType == "audio") {
        hasAudioInput = true;
      }
    }

    // --- Setup Agent ---
    const agent = await this.agentFactory.get(agent_id);
    if (!agent) throw new Error(`No agent found for id ${agent_id}`);
    const { model = 'gemini-2.5-flash', system_prompt = 'You are a helpful AI Agent.' } = agent.config;
    if (sessionId === undefined) {
      sessionId = uuidv4();
    }
    // --- Setup Session -- 
    if (user_id) {
      switch (sessionCommand) {
        case 'new':
          console.log("Session command: NEW. Starting a fresh session.");

          let graphitiResults: any = null;

          if (is_bot === false) {
            const name = first_name?.trim() || username?.trim();

            await sendResponse(
              event,
              {
                type: 'text',
                text: `🔍 Retrieving context from previous interactions...`,
                // placeholder_message_id will be automatically added if includePlaceholder is true
              },
              {
                includePlaceholder: !!placeholder_message_id,
                editMessage: true
              }
            );

            if (name) {
              try {
                const searchResponse = await searchGraphiti({ text: name });
                graphitiResults = searchResponse?.results || null;

                const nodeCount = graphitiResults?.nodes?.length || 0;
                const edgeCount = graphitiResults?.edges?.length || 0;
                console.log(`Graphiti search found ${nodeCount} nodes and ${edgeCount} edges for "${name}".`);
              } catch (error) {
                console.error("Error searching Graphiti:", error);
              }
            } else {
              console.log("⚠️ No valid name found — skipping Graphiti search.");
            }
          }

          // Build readable summaries from the nodes and edges
          let graphitiContext = "";

          if (graphitiResults) {
            const nodeSummaries =
              graphitiResults.nodes
                ?.slice(0, 5) // limit to top 5 nodes
                .map((node: any) => `- ${node.name}: ${node.summary}`)
                .join("\n") || "";

            const edgeFacts =
              graphitiResults.edges
                ?.slice(0, 5)
                .map((edge: any) => `- ${edge.fact}`)
                .join("\n") || "";

            if (nodeSummaries || edgeFacts) {
              graphitiContext = `Here are relevant facts about ${first_name || user_id} from the previous conversations:\n\n` +
                (nodeSummaries ? `🧠 Entities:\n${nodeSummaries}\n\n` : "") +
                (edgeFacts ? `🔗 Relationships:\n${edgeFacts}\n\n` : "") +
                (`If there are any location information provided, it is probably outdated and you should confirm the user's location if it is required.`);
            }
          }
          const systemMessage: SystemMessage = {
            role: "system",
            content: [
              {
                type: "text",
                text: system_prompt,
              },
              ...(graphitiContext
                ? [
                  {
                    type: "text" as const,
                    text: graphitiContext,
                  },
                ]
                : []),
            ],
          };

          await tursoClient.logConversation({
            model,
            role: 'system',
            message: JSON.stringify(systemMessage),
            user_id: user_id,
            chat_id: chat_id,
            session_id: sessionId,
            agent_id: agent_id,
          });

          conversation.push(systemMessage);
          break;
        case undefined:
        // Fall-through: This case has no 'break;', so the execution falls directly
        default:
          console.log("Session command: None.");
          // Existing Session; Fetch Conversation History
          const rows = await tursoClient.getLatestConversationByuser_id(user_id);

          // Verify if last message is within new session threshold
          const latestMessage = rows[rows.length - 1];
          const latestTimestamMs = Number(latestMessage.timestamp) * 1000;
          const timeThreshold = THRESHOLD_HOURS * 60 * 60 * 1000; // 10,800,000 milliseconds
          const timeDifference = Date.now() - latestTimestamMs;

          if (timeDifference > timeThreshold) {
            console.log(`Session older than ${THRESHOLD_HOURS} hours.`);
            let graphitiResults: any = null;

            if (is_bot === false) {
              const name = first_name?.trim() || username?.trim();

              await sendResponse(
                event,
                {
                  type: 'text',
                  text: `🔍 Retrieving context from previous interactions...`,
                  // placeholder_message_id will be automatically added if includePlaceholder is true
                },
                {
                  includePlaceholder: !!placeholder_message_id,
                  editMessage: true
                }
              );

              if (name) {
                try {
                  const searchResponse = await searchGraphiti({ text: name });
                  graphitiResults = searchResponse?.results || null;

                  const nodeCount = graphitiResults?.nodes?.length || 0;
                  const edgeCount = graphitiResults?.edges?.length || 0;
                  console.log(`Graphiti search found ${nodeCount} nodes and ${edgeCount} edges for "${name}".`);
                } catch (error) {
                  console.error("Error searching Graphiti:", error);
                }
              } else {
                console.log("⚠️ No valid name found — skipping Graphiti search.");
              }
            }

            // Build readable summaries from the nodes and edges
            let graphitiContext = "";

            if (graphitiResults) {
              const nodeSummaries =
                graphitiResults.nodes
                  ?.slice(0, 5) // limit to top 5 nodes
                  .map((node: any) => `- ${node.name}: ${node.summary}`)
                  .join("\n") || "";

              const edgeFacts =
                graphitiResults.edges
                  ?.slice(0, 5)
                  .map((edge: any) => `- ${edge.fact}`)
                  .join("\n") || "";

              if (nodeSummaries || edgeFacts) {
                graphitiContext = `Here are relevant facts about ${first_name || user_id} from the Graphiti knowledge graph:\n\n` +
                  (nodeSummaries ? `🧠 Entities:\n${nodeSummaries}\n\n` : "") +
                  (edgeFacts ? `🔗 Relationships:\n${edgeFacts}\n\n` : "") +
                  (`If there are any location information provided, it is probably outdated and you should confirm the user's location if it is required.`);
              }
            }

            const systemMessage: SystemMessage = {
              role: "system",
              content: [
                {
                  type: "text",
                  text: system_prompt,
                },
                ...(graphitiContext
                  ? [
                    {
                      type: "text" as const,
                      text: graphitiContext,
                    },
                  ]
                  : []),
              ],
            };

            await tursoClient.logConversation({
              model,
              role: 'system',
              message: JSON.stringify(systemMessage),
              user_id: user_id,
              chat_id: chat_id,
              session_id: sessionId,
              agent_id: agent_id,
            });

            conversation.push(systemMessage);
          } else {
            console.log(`Session within ${THRESHOLD_HOURS} hours.`);
            sessionId = String(latestMessage.session_id); // use Session ID found on message.
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
            // User ask to chat with new Agent within the session
            if (agent_idOverwritten) {
              let graphitiResults: any = null;

              if (is_bot === false) {
                const name = first_name?.trim() || username?.trim();

                await sendResponse(
                  event,
                  {
                    type: 'text',
                    text: `🔍 Retrieving context from previous interactions...`,
                    // placeholder_message_id will be automatically added if includePlaceholder is true
                  },
                  {
                    includePlaceholder: !!placeholder_message_id,
                    editMessage: true
                  }
                );

                if (name) {
                  try {
                    const searchResponse = await searchGraphiti({ text: name });
                    graphitiResults = searchResponse?.results || null;

                    const nodeCount = graphitiResults?.nodes?.length || 0;
                    const edgeCount = graphitiResults?.edges?.length || 0;
                    console.log(`Graphiti search found ${nodeCount} nodes and ${edgeCount} edges for "${name}".`);
                  } catch (error) {
                    console.error("Error searching Graphiti:", error);
                  }
                } else {
                  console.log("⚠️ No valid name found — skipping Graphiti search.");
                }
              }

              // Build readable summaries from the nodes and edges
              let graphitiContext = "";

              if (graphitiResults) {
                const nodeSummaries =
                  graphitiResults.nodes
                    ?.slice(0, 5) // limit to top 5 nodes
                    .map((node: any) => `- ${node.name}: ${node.summary}`)
                    .join("\n") || "";

                const edgeFacts =
                  graphitiResults.edges
                    ?.slice(0, 5)
                    .map((edge: any) => `- ${edge.fact}`)
                    .join("\n") || "";

                if (nodeSummaries || edgeFacts) {
                  graphitiContext = `Here are relevant facts about ${first_name || user_id} from the Graphiti knowledge graph:\n\n` +
                    (nodeSummaries ? `🧠 Entities:\n${nodeSummaries}\n\n` : "") +
                    (edgeFacts ? `🔗 Relationships:\n${edgeFacts}\n\n` : "") +
                    (`If there are any location information provided, it is probably outdated and you should confirm the user's location if it is required.`);
                }
              }

              const systemMessage: SystemMessage = {
                role: "system",
                content: [
                  {
                    type: "text",
                    text: system_prompt,
                  },
                  ...(graphitiContext
                    ? [
                      {
                        type: "text" as const,
                        text: graphitiContext,
                      },
                    ]
                    : []),
                ],
              };
              await tursoClient.logConversation({
                model,
                role: 'system',
                message: JSON.stringify(systemMessage),
                user_id: user_id,
                chat_id: chat_id,
                session_id: sessionId,
                agent_id: agent_id,
              });

              conversation.push(systemMessage);
            }
          }
      }
    }
    else {
      if (sessionId === undefined) {
        const systemMessage: SystemMessage = {
          role: "system",
          content: [
            {
              type: "text",
              text: system_prompt,
            }
          ],
        };
        await tursoClient.logConversation({
          model,
          role: 'system',
          message: JSON.stringify(systemMessage),
          session_id: sessionId,
          agent_id: agent_id,
        });

        conversation.push(systemMessage);
      } else {
        const rows = await tursoClient.getLatestConversationBySessionId(sessionId)
        if (rows.length === 0) {
          const systemMessage: SystemMessage = {
            role: "system",
            content: [
              {
                type: "text",
                text: system_prompt,
              }
            ],
          };
          await tursoClient.logConversation({
            model,
            role: 'system',
            message: JSON.stringify(systemMessage),
            session_id: sessionId,
            agent_id: agent_id,
          });

          conversation.push(systemMessage);
        } else {
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
        }


      }
    }
    const userMessage: UserMessage = convertEventToUserMessage(event);

    await tursoClient.logConversation({
      model,
      role: 'system',
      message: JSON.stringify(userMessage),
      user_id: user_id,
      chat_id: chat_id,
      session_id: sessionId,
      agent_id: agent_id,
    });
    conversation.push(userMessage);

    // --- LLM loop ---
    let finalAssistantText = '';
    let firstOutgoingMessageSent = false;

    // Fetch MCP tools
    const allTools = await this.mcpClient.listTools();

    // Get allowed tools from the agent configuration
    const allowedTools = agent.config.mcp_servers?.flatMap(server => server.allowed_tools) ?? [];

    // Filter the MCP tool list based on allowed tools
    let llmTools = allTools.filter(tool => allowedTools.includes(tool.name));

    // --- Add built-in Google tools if specified ---
    const googleToolMap: Record<string, (event: Event) => any> = {
      "google_search": () => ({ googleSearch: {} }),
      "google_maps": () => ({ googleMaps: {} }),
      "google_url_context": () => ({ urlContext: {} })
    };
    // If allowed_tools contains any of these names, append the corresponding entries
    const extraTools = allowedTools
      .filter(name => googleToolMap[name]) // keep only recognized google tools
      .map(name => googleToolMap[name](event));

    if (extraTools.length > 0) {
      console.log("🧩 Adding Google tools:", extraTools);
      llmTools = [...llmTools, ...extraTools];
    }

    while (true) {
      console.log(`========\nConversation to LLM\n: ${JSON.stringify(conversation)}`);
      const response: any = await this.llm.getLLMResponse({ model, conversation, tools: llmTools });
      console.log(`========\nResponse from LLM\n: ${JSON.stringify(response)}`);
      const choice = response?.choices?.[0];
      const responseMessageRaw = choice.message;
      const sanitizedMessage = sanitizeResponseMessage(responseMessageRaw);
      const responseMessage: AssistantMessage = sanitizedMessage as AssistantMessage;

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
        user_id: user_id,
        chat_id: chat_id,
        session_id: sessionId,
        agent_id: agent_id,
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

        if (is_bot === false) {
          await sendResponse(
            event,
            {
              type: 'text',
              text: `🛠 Resolving ${toolCalls.length} tool call(s)`,
              // placeholder_message_id will be automatically added if includePlaceholder is true
            },
            {
              includePlaceholder: !!placeholder_message_id,
              editMessage: true
            }
          );
        }

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

          // --- Extract the relevant content/messages array ---
          let contentArray: any[] = [];

          if (toolResult?.result?.content) {
            // Case 1: result.content
            contentArray = toolResult.result.content;
          } else if (toolResult?.messages) {
            // Case 2: messages
            contentArray = toolResult.messages;
          } else {
            // Fallback if neither exists
            contentArray = [toolResult];
          }

          // --- Build ToolMessage ---
          const toolMessage: ToolMessage = {
            role: "tool",
            content: JSON.stringify(contentArray, null, 2),
            tool_call_id,
          };

          // --- Log into DB ---
          await tursoClient.logConversation({
            model,
            role: 'tool',
            message: JSON.stringify(toolMessage),
            user_id: user_id,
            chat_id: chat_id,
            session_id: sessionId,
            agent_id: agent_id,
          });

          conversation.push(toolMessage);
        }
      }
      // --- Final assistant text ---
      else if (finishReason === 'stop' && responseMessage.content !== null) {
        if (is_bot === false) {
          await sendResponse(
            event,
            {
              type: 'text',
              text: `🤔 Thinking it through and preparing your reply...`,
              // placeholder_message_id will be automatically added if includePlaceholder is true
            },
            {
              includePlaceholder: !!placeholder_message_id,
              editMessage: true
            }
          );
        }

        finalAssistantText = responseMessage.content;

        const outgoingMessages: ResponseMessage[] = [
          { type: 'text', text: finalAssistantText }
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

        const hasRecipients = event.recipients && event.recipients.length > 0;
        if (hasRecipients) {
          await sendResponse(event, outgoingMessages, {
            includePlaceholder: !firstOutgoingMessageSent && placeholder_message_id != null
          });

          firstOutgoingMessageSent = true;

          // -- Graphiti --
          if (is_bot === false) {
            let message: string = "";
            if (hasAudioInput) {
              try {
                const audioContent = userMessage.content.find(c => c.type === 'input_audio')?.input_audio;

                if (audioContent?.data) {
                  message = await this.llm.audioToText(audioContent.data, audioContent.format);
                }
              } catch (err) {
                console.error('❌ STT failed, not sending to Graphiti', err);
              }
            } else {
              message = userMessage.content.find(c => c.type === 'text')?.text ?? "";
            }
            await sendGraphitiEpisode({
              sessionId: sessionId,
              messageCount: conversation.length,
              firstName: first_name,
              username: username,
              agentId: agent_id,
              userMessage: message,
            });
          }
          return
        } else {
          return {
            id: event.id,
            messages: outgoingMessages,
            metadata: {
              agent_id,
              session_id: sessionId
            }
          };
        }
      }
    }
  }
}