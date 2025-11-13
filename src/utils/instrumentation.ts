import { configureOpentelemetry } from '@uptrace/node';
import * as dotenv from 'dotenv';

// Load env vars immediately so UPTRACE_DSN is available
dotenv.config(); 

// configureOpentelemetry({
//   // Set this in your .env file
//   dsn: process.env.UPTRACE_DSN, 
//   serviceName: process.env.SPACE_ID,
//   serviceVersion: '1.0.0',
//   deploymentEnvironment: 'production',
// });

const dsn = process.env.UPTRACE_DSN;
const serviceName = process.env.SPACE_ID;

if (!dsn || dsn.trim() === '') {
  // ❌ IMPORTANT: If you see this, the secret is not configured correctly in the Space.
  console.error("❌ OTel CRITICAL ERROR: UPTRACE_DSN is NOT set. Tracing is disabled.");
  
  // Optional: Fallback to console exporter for local debugging
  // You can comment this out once tracing is working.
  // configureOpentelemetry({
  //     serviceName: 'royzheng-agents',
  //     exporter: new ConsoleSpanExporter(), 
  // });
} else {
    // 🟢 Confirms the secret was successfully loaded.
    console.log(`✅ OTel DSN check passed. Service: royzheng-agents.`); 

    configureOpentelemetry({
        dsn: dsn, 
        serviceName: serviceName,
        serviceVersion: '1.0.0',
        deploymentEnvironment: 'production',
    });
}