import { getDb } from '../../clients/mongodb.js';

/**
 * Agent configuration interface
 */
export interface AgentConfig {
  agentId: string;
  name: string;
  systemPrompt: string;
  model?: string;
  allowedUserIds?: (string | number)[];
  allowedChatIds?: (string | number)[];
  mcps?: string[];
  geminiVoice?: string;
  [key: string]: any;
}

/**
 * Minimal agent object
 */
export class Agent {
  config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }
}

/**
 * Factory to fetch agent config from MongoDB
 */
export class AgentFactory {
  /**
   * Get agent by agentId
   */
  public async get(agentId: string): Promise<Agent | null> {
    const db = await getDb();
    const collection = db.collection<AgentConfig>('agent_config');
    const config = await collection.findOne({ agentId });

    if (!config) return null;

    return new Agent(config); // config includes model
  }
}
