import { configureOpentelemetry } from '@uptrace/node';
import * as dotenv from 'dotenv';

// Load env vars immediately so UPTRACE_DSN is available
dotenv.config(); 

configureOpentelemetry({
  // Set this in your .env file
  dsn: process.env.UPTRACE_DSN, 
  serviceName: 'royzheng-agents',
  serviceVersion: '1.0.0',
  deploymentEnvironment: 'production',
});