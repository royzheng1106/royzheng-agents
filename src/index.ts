/**
 * @fileoverview Main entry point for the royzheng agents service.
 * Configures Express, initializes OpenTelemetry tracing, sets up middleware,
 * connects to MongoDB, and defines core API routes for event processing.
 */

import express from 'express';
import type { Event } from './models/Event.js';
import { CONFIG } from './utils/config.js';
import { AgentFactory } from './agents/factory/index.js';
import { Orchestrator } from './orchestrator/index.js';
import { client as mongoClient } from './clients/mongodb.js';
import agentsRouter from "./agents/index.js";
// Imports the OpenTelemetry setup and the SpanStatusCode constants
import { setupOpenTelemetry, SpanStatusCode } from './utils/openTelemetry.js';

/** Checks if the application is running in a Vercel environment. */
const IS_VERCEL = process.env.VERCEL === '1';
const app = express();

/**
 * Initializes and starts the OpenTelemetry SDK. The returned tracer is used
 * for manual span creation throughout the application.
 * @type {import('@opentelemetry/api').Tracer}
 */
const tracer = await setupOpenTelemetry();
console.log(`Tracer: ${tracer}`);

// Increase request size limit to handle potential base64 audio and large payloads.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

/**
 * Express middleware to validate the 'x-api-key' or 'Authorization: Bearer' header.
 * The check is bypassed if the environment is not Vercel.
 *
 * @param {express.Request} req - The Express request object.
 * @param {express.Response} res - The Express response object.
 * @param {express.NextFunction} next - The next middleware function.
 * @returns {void | express.Response} Calls next() on success or sends 401 on failure.
 */
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

/**
 * Health check endpoint.
 * @route GET /
 */
app.get('/', (_req, res) => res.status(200).send('💻 royzheng-agents running'));

/**
 * Standard health check endpoint.
 * @route GET /_health
 */
app.get('/_health', (_req, res) => res.status(200).send('💻 royzheng-agents running'));

// Initialize core services
const agentFactory = new AgentFactory();
const orchestrator = new Orchestrator(agentFactory);

/**
 * Validates the structure and content of an incoming Event payload.
 *
 * @param {Event} event - The incoming event object from the request body.
 * @returns {string | null} An error message string if validation fails, or null if valid.
 */
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

/**
 * Main API endpoint for processing incoming platform events.
 * It enforces API key validation and wraps the event processing logic in an OpenTelemetry span.
 *
 * @route POST /api/events
 */
app.post('/api/events', requireApiKey, async (req, res) => {
  const event: Event = req.body;

  // Start a new span for tracing the entire HTTP request handling process.
  return tracer.startActiveSpan('agents.events', async (span) => {
    try {
      const validationError = validateEvent(event);

      // Add relevant attributes to the current span for better tracing context.
      span.setAttribute('event.id', event.id);
      span.setAttribute('event.source', event.sender?.source || 'unknown');
      console.log(span);
      if (validationError) {
        // Record validation error on the span and set span status to ERROR.
        span.recordException(new Error(validationError));
        span.setStatus({ code: SpanStatusCode.ERROR, message: validationError });
        span.end();
        console.log(span);
        return res.status(400).json({ ok: false, error: validationError });
      }

      // Delegate event processing to the Orchestrator.
      const response = await orchestrator.handleEvent(event);

      // End the span upon successful completion.
      span.end();
      return res.status(200).json(response || { ok: true });
    } catch (err: any) {
      // Catch and record any internal errors on the span.
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.end();
      return res.status(500).json({ ok: false, error: err.message });
    }
  });
});


/**
 * Routes for agent-specific endpoints. They are protected by the API key middleware.
 * @route /api/agents
 */
app.use("/api/agents", requireApiKey, agentsRouter);

/**
 * Handles the application startup sequence: connecting to MongoDB and starting the Express server.
 *
 * @async
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB Atlas');

    // Only start the local listener if not running on Vercel (or a similar serverless platform).
    if (!CONFIG.IS_VERCEL) {
      app.listen(CONFIG.PORT, () => {
        console.log(`💻 Local server running at http://localhost:${CONFIG.PORT}`);
      });
    }
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1); // Exit process on critical startup failure
  }
}

// Execute the startup function.
startServer();

/**
 * Exports the Express app instance. Useful for Vercel/serverless environments
 * where the app needs to be exported rather than self-listening.
 * @type {express.Application}
 */
export default app;