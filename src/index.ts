import express from 'express';
import type { Event } from './models/Event.js';
import { CONFIG } from './utils/config.js';
import { AgentFactory } from './agents/factory/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { client as mongoClient } from './clients/mongodb.js';
import agentsRouter from "./agents/index.js";
import { setupOpenTelemetry, SpanStatusCode } from './utils/openTelemetry.js'; // Use the new file

const IS_VERCEL = process.env.VERCEL === '1';
const app = express();
const tracer = await setupOpenTelemetry();
console.log(`Tracer: ${tracer}`);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

// Middleware to validate API key
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!IS_VERCEL) {
    console.log("Bypassing API Key check as it is not Vercel.");
    return next();
  }

  let apiKey = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'];

  if (!apiKey) {
    const authHeader = Array.isArray(req.headers['authorization'])
      ? req.headers['authorization'][0]
      : req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) apiKey = authHeader.substring(7);
  }

  if (apiKey !== CONFIG.API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: invalid API key' });
  }

  next();
}

// Health check
app.get('/', (_req, res) => res.status(200).send('💻 royzheng-agents running'));
app.get('/_health', (_req, res) => res.status(200).send('💻 royzheng-agents running'));

// Initialize database + orchestrator
const agentFactory = new AgentFactory();
const orchestrator = new Orchestrator(agentFactory);

// Validate incoming event payload
function validateEvent(event: Event): string | null {
  if (!event?.id || !event?.sender?.source || !event?.timestamp || !event?.messages) {
    return 'Invalid Event: missing id, source, timestamp, or messages';
  }

  if (event.recipients?.length) {
    for (const r of event.recipients) {
      if (!r.channel) return 'Recipient missing channel';
      if (r.channel === 'telegram' && !r.chat_id) return 'Telegram recipient must have chat_id';
      if (r.channel !== 'telegram' && !r.id) return `Recipient for channel "${r.channel}" must have id`;
    }
  }

  return null;
}


// Main events endpoint
app.post('/api/events', requireApiKey, async (req, res) => {
  const event: Event = req.body;

  // Start a manual HTTP span for this request
  return tracer.startActiveSpan('http.request', async (span) => {
    try {
      const validationError = validateEvent(event);

      // Add event attributes to the span
      span.setAttribute('event.id', event.id);
      span.setAttribute('event.source', event.sender?.source || 'unknown');
      console.log(span);
      if (validationError) {
        span.recordException(new Error(validationError));
        span.setStatus({ code: SpanStatusCode.ERROR, message: validationError });
        span.end();
        console.log(span);
        return res.status(400).json({ ok: false, error: validationError });
      }

      // Process the event
      const response = await orchestrator.handleEvent(event);

      span.end();
      return res.status(200).json(response || { ok: true });
    } catch (err: any) {
      // Record any errors on the span
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
});

app.use("/api/agents", requireApiKey, agentsRouter);

async function startServer() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');

    if (!CONFIG.IS_VERCEL) {
      app.listen(CONFIG.PORT, () => {
        console.log(`💻 Local server running at http://localhost:${CONFIG.PORT}`);
      });
    }
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

export default app;
