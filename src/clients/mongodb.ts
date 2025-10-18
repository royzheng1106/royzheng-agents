// src/clients/mongo.ts
import { MongoClient, ServerApiVersion } from 'mongodb';
import { CONFIG } from '../utils/config.js';

if (!CONFIG.MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not set');
}

const uri: string = CONFIG.MONGODB_URI;

// Create a MongoClient with Stable API version
export const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

/**
 * Connect and return the database instance
 */
export async function getDb() {
  await client.connect();
  return client.db(CONFIG.MONGODB_DB_NAME || 'royzheng_agents');
}