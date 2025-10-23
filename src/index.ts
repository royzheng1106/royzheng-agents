import express from 'express';
import type { Event } from './models/Event.js';
import { CONFIG } from './utils/config.js';
import { AgentFactory } from './agents/factory/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { client as mongoClient } from './clients/mongodb.js';
import agentsRouter from "./agents/index.js";
import { tursoClient } from './clients/turso.js';

const app = express();

// Increase request size limit to handle base64 audio
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Middleware to validate API key
function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  // const apiKey = req.headers['x-api-key'];

  // if (apiKey !== CONFIG.API_KEY) {
  //   return res.status(401).json({ ok: false, error: 'Unauthorized: invalid API key' });
  // }

  next();
}


// Health check
app.get('/', (_req, res) => res.status(200).send('💻 royzheng-agents running'));

// Initialize database + orchestrator
const agentFactory = new AgentFactory();
const orchestrator = new Orchestrator(agentFactory);

/**
 * Validate incoming event payload.
 * - Must contain id, source, timestamp, payload
 * - Each recipient must have valid fields depending on channel
 */
function validateEvent(event: Event): string | null {
  if (!event?.id || !event?.sender.source || !event?.timestamp || !event?.messages) {
    return 'Invalid Event: missing id, source, timestamp, or payload';
  }

  if (!event.recipients.length) {
    return 'Event must include at least one recipient';
  }

  for (const r of event.recipients) {
    if (!r.channel) return 'Recipient missing channel';
    if (r.channel === 'telegram') {
      if (!r.chatId) return 'Telegram recipient must have chatId';
    } else if (!r.id) {
      return `Recipient for channel "${r.channel}" must have id`;
    }
  }

  return null;
}

/**
 * Main events endpoint
 */
app.post('/api/events', requireApiKey, async (req, res) => {
  const event: Event = req.body;

  const validationError = validateEvent(event);
  if (validationError) {
    return res.status(400).json({ ok: false, error: validationError });
  }

  console.log(`📩 Received event: ${JSON.stringify(event)}`);

  try {
    await orchestrator.handleEvent(event);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('❌ Error handling event:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.use("/api/agents", requireApiKey, agentsRouter);

app.get('/api/test-turso', requireApiKey, async (_req, res) => {
  try {
    const result = await tursoClient.testConnection();
    res.status(200).json({
      ok: true,
      message: 'Turso connection OK',
      result: result.rows,
    });
  } catch (err) {
    console.error('❌ Turso test endpoint error:', err);
    res.status(500).json({
      ok: false,
      message: 'Failed to connect to Turso',
      error: err instanceof Error ? err.message : err,
    });
  }
});

/**
 * Startup logic
 */
async function startServer() {
  try {
    await mongoClient.connect();
    console.log('✅ Connected to MongoDB Atlas');

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
