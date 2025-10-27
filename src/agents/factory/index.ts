import { getDb } from '../../clients/mongodb.js';

/**
 * Agent configuration interface
 */
export interface MCPServerConfig {
  url: string;
  api_key: string;
  allowed_tools: string[];
}

export interface AgentConfig {
  agent_id: string;
  name: string;
  system_prompt: string;
  model?: string;
  // alloweduser_ids?: (string | number)[];
  // allowedchat_ids?: (string | number)[];
  mcp_servers?: MCPServerConfig[];
  gemini_voice?: string;
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
   * Get agent by agent_id
   */
  public async get(agent_id: string): Promise<Agent | null> {
    const db = await getDb();
    const collection = db.collection<AgentConfig>('agent_config');
    const config = await collection.findOne({ agent_id });

    if (!config) return null;

    return new Agent(config); // config includes model
  }
}
