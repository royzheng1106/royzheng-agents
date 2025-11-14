// /utils/openTelemetry.ts

import { trace, SpanStatusCode, Tracer } from '@opentelemetry/api';
import { configureOpentelemetry } from '@uptrace/node'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
import { CONFIG } from './config.js';

/**
 * Configures and starts the OpenTelemetry SDK.
 * @returns The OpenTelemetry Tracer instance.
 */
export async function setupOpenTelemetry(): Promise<Tracer> {
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
      new MongoDBInstrumentation(),
    ],
  });

  await sdk.start();
  console.log(`✅ OpenTelemetry SDK started for ${CONFIG.SPACE_ID}`);

  // Create and return the tracer
  const tracer = trace.getTracer('agents-service', '1.0.0');
  return tracer;
}

export { SpanStatusCode };