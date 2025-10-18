import { createClient } from '@libsql/client';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../utils/config.js';

type Role = 'user' | 'assistant' | 'system' | 'tool';

export class TursoClient {
  private db;

  constructor() {
    this.db = createClient({
      url: CONFIG.TURSO_URL!,
      authToken: CONFIG.TURSO_AUTH_TOKEN!,
    });
  }

  /**
   * Log conversation message into conversation_history.
   * Stores all message content (tools, thinking_blocks, images) in `message`.
   */
  public async logConversation(params: {
    model: string;
    role: Role;
    finish_reason?: string | null;
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
    user_id?: string;
    chat_id?: string;
    session_id?: string;
    agent_id?: string;
    message: string;
  }): Promise<void> {
    const id = uuidv4();
    const ts = Math.floor(Date.now() / 1000);

    const {
      model,
      role,
      finish_reason = null,
      completion_tokens = 0,
      prompt_tokens = 0,
      total_tokens = 0,
      user_id,
      chat_id,
      session_id,
      agent_id,
      message,
    } = params;

    try {
      await this.db.execute({
        sql: `
          INSERT INTO conversation_history (
            id, model, finish_reason, role,
            completion_tokens, prompt_tokens, total_tokens,
            user_id, chat_id, session_id, agent_id, timestamp, message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          model,
          finish_reason ?? '',
          role,
          completion_tokens,
          prompt_tokens,
          total_tokens,
          user_id ?? null,
          chat_id ?? null,
          session_id ?? null,
          agent_id ?? null,
          ts,
          message,
        ],
      });
    } catch (err) {
      console.error('❌ Turso logConversation error:', err, { model, role, user_id, chat_id, session_id, agent_id });
      throw err;
    }
  }

  public async getLatestConversation(userId: string) {
    const userIdStr = String(userId);

    const sql = `
      SELECT
        *
      FROM
        conversation_history
      WHERE
        session_id = (
          SELECT
            session_id
          FROM
            conversation_history
          WHERE
            user_id = ?
          ORDER BY
            timestamp DESC
          LIMIT 1
        )
      ORDER BY
        timestamp ASC
    `;

    const res = await this.db.execute({
      sql: sql,
      args: [userIdStr],
    });

    return res.rows ?? [];
  }

  /**
   * Fetch all messages for a session, ordered by timestamp asc.
   * Returns raw rows from DB.
   */
  // public async getConversation(sessionId: string) {
  //   const res = await this.db.execute({
  //     sql: `SELECT * FROM conversation_history WHERE session_id = ? ORDER BY timestamp ASC`,
  //     args: [sessionId],
  //   });
  //   return res.rows ?? [];
  // }

  /**
   * Get latest session for a user or create a new session.
   */
  // public async getOrCreateSession(userId: string, maxAgeHours = 3): Promise<{ sessionId: string; isNew: boolean }> {
  //   const userIdStr = String(userId);

  //   const res = await this.db.execute({
  //     sql: `SELECT session_id, timestamp FROM conversation_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
  //     args: [userIdStr],
  //   });

  //   const latest = res?.rows?.[0];
  //   const cutoff = Math.floor(Date.now() / 1000) - maxAgeHours * 60 * 60;

  //   if (latest && typeof latest.timestamp === 'number' && latest.timestamp > cutoff && latest.session_id) {
  //     return { sessionId: String(latest.session_id), isNew: false };
  //   }

  //   return { sessionId: uuidv4(), isNew: true };
  // }

  public async getSession(userId: string): Promise<{ sessionId: string }> {
    const userIdStr = String(userId);

    const res = await this.db.execute({
      sql: `SELECT session_id, timestamp FROM conversation_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
      args: [userIdStr],
    });
    const latest = res?.rows?.[0];

    return { sessionId: String(latest.session_id) };
  }

  /**
   * Simple connectivity test
   */
  public async testConnection() {
    return this.db.execute({ sql: 'SELECT 1 as ok', args: [] });
  }
}

export const tursoClient = new TursoClient();
