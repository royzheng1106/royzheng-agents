import { CONFIG } from "../utils/config.js"
import { trace, SpanStatusCode, Tracer } from '@opentelemetry/api';

const tracer: Tracer = trace.getTracer('agents-service', '1.0.0');

interface GraphitiPayload {
  sessionId: string;
  messageCount: number;
  username?: string;
  firstName?: string;
  agentId: string;
  userMessage: string;
}

interface GraphitiSearchPayload {
  text: string;
}

/**
 * Sends an episode creation request to the Graphiti queue API.
 */
export async function sendGraphitiEpisode({
  sessionId,
  messageCount,
  username,
  firstName,
  agentId,
  userMessage,
}: GraphitiPayload): Promise<void> {

  // 🌟 SPAN for sending Graphiti episode
  await tracer.startActiveSpan('Graphiti.sendEpisode', {
    attributes: {
      'session.id': sessionId,
      'agent.id': agentId,
      'message.count': messageCount,
    }
  }, async (graphitiSpan) => {
    try {
      const enqueueUrl = "https://royzheng-rmq.hf.space/enqueue";

      const displayName = username || firstName || "User";

      const data = {
        url: "https://royzheng-graphiti-03.hf.space/api/add-episode",
        headers: {
          Authorization: `Bearer ${CONFIG.GRAPHITI_API_KEY}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        payload: {
          name: `${sessionId}_${messageCount}`,
          episode_body: `${displayName}: ${userMessage}`,
          source: "message",
          source_description: `Chat with AI Agent ${agentId}`,
          reference_time: new Date().toISOString(),
        },
      };

      const response = await fetch(enqueueUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.RMQ_API_KEY}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Graphiti enqueue failed: ${response.status} - ${errText}`);
      }

      console.log(`✅ Graphiti episode queued: ${sessionId}_${messageCount}`);
      graphitiSpan.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      graphitiSpan.recordException(err as Error);
      graphitiSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err; // Re-throw to propagate error
    } finally {
      graphitiSpan.end();
    }
  });
}

/**
 * Searches the Graphiti API for matching episodes or content.
 */
export async function searchGraphiti({ text }: GraphitiSearchPayload): Promise<any> {
  // 🌟 GRAPHITI SEARCH SPAN
  const result = await tracer.startActiveSpan('Graphiti.search', {
    attributes: {
      'search.term': text,
    }
  }, async (searchSpan) => {
    try {
      const searchUrl = "https://royzheng-graphiti.hf.space/api/search";

      const response = await fetch(searchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CONFIG.GRAPHITI_API_KEY}`,
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Graphiti search failed: ${response.status} - ${errText}`);
      }

      const result = await response.json();
      console.log("🔍 Graphiti search result:", result);
      searchSpan.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      searchSpan.recordException(err as Error);
      searchSpan.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err; // Re-throw to propagate error
    } finally {
      searchSpan.end();
    }
  });
  return result;
}