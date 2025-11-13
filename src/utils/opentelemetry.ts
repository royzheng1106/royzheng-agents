import { configureOpentelemetry } from '@uptrace/node';
// …
const sdk = configureOpentelemetry({
  dsn: process.env.UPTRACE_DSN,
  serviceName: 'myservice',
  serviceVersion: '1.0.0',
});
await sdk.start();
