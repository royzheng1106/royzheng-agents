import dotenv from "dotenv";

/**
 * Determine the current environment.
 * Defaults to 'development' if APP_ENV is not set.
 */
export const APP_ENV = process.env.APP_ENV || "development";

/**
 * Load .env file only in development
 */
if (APP_ENV === "development") {
  dotenv.config();
  console.log("[keys.ts] Loaded local .env file for development");
} else {
  console.log(`[keys.ts] Using system environment for: ${APP_ENV}`);
}

/**
 * Helper to fetch required environment variables
 */
function getEnv(key: string): string | undefined {
  const value = process.env[key];
  if (!value) {
    console.warn(`[keys.ts] ⚠️ Missing environment variable: ${key}`);
  }
  return value;
}

/**
 * Centralized configuration
 */
export const CONFIG = {
  APP_ENV,
  IS_VERCEL: process.env.VERCEL === "1",
  PORT: process.env.PORT || 7860,
  MONGODB_URI: getEnv("MONGODB_URI"),
  MONGODB_DB_NAME: getEnv("MONGODB_DB_NAME") || "agents",
  API_KEY: getEnv("API_KEY"),
  LLM_API_KEY: getEnv("LLM_API_KEY"),
  INT_API_KEY: getEnv("INT_API_KEY"),
  TURSO_URL: getEnv("TURSO_URL"),
  TURSO_AUTH_TOKEN: getEnv("TURSO_AUTH_TOKEN"),
  MCP_API_KEY: getEnv("MCP_API_KEY"),
  GRAPHITI_API_KEY: getEnv("GRAPHITI_API_KEY"),
  RMQ_API_KEY: getEnv("RMQ_API_KEY"),
  UPTRACE_DSN: getEnv("UPTRACE_DSN"),
  SPACE_ID: getEnv("SPACE_ID")
};
