// /utils/openTelemetry.ts

import { trace, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { configureOpentelemetry } from '@uptrace/node'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
import { CONFIG } from './config.js'; // Assuming CONFIG is available here

/**
 * Configures and starts the OpenTelemetry SDK.
 * @returns The OpenTelemetry Tracer instance.
 */
export async function setupOpenTelemetry(): Promise<Tracer> {
  // Use the configuration from the original file
  const sdk = configureOpentelemetry({
    dsn: CONFIG.UPTRACE_DSN,
    serviceName: CONFIG.SPACE_ID,
    serviceVersion: '1.0.0',
  });

  registerInstrumentations({
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: /.*/,
      }),
      // The original code had two FetchInstrumentation instances,
      // which is likely unnecessary. I'll include the one with the config.
      // If the second one is needed for a specific reason, you can re-add it.
      new MongoDBInstrumentation(),
    ],
  });

  await sdk.start();
  console.log(`✅ OpenTelemetry SDK started for ${CONFIG.SPACE_ID}`);

  // Create and return the tracer
  const tracer = trace.getTracer('agents-service', '1.0.0');
  return tracer;
}

// Optionally, you might want to export SpanStatusCode if you use it often.
export { SpanStatusCode };