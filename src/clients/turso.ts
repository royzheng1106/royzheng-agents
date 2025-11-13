import { createClient } from '@libsql/client';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../utils/config.js';
import { trace, SpanStatusCode, Tracer } from '@opentelemetry/api'; 

const DB_SYSTEM = 'sqlite';

const tracer: Tracer = trace.getTracer('agents-service', '1.0.0');

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
    // 1. Start Manual Span for Database Operation
    return tracer.startActiveSpan('TursoClient.logConversation', {
        attributes: {
            'db.system': DB_SYSTEM,
            'db.operation': 'INSERT',
            'db.collection.name': 'conversation_history',
            'db.query.summary': 'INSERT conversation_history',
        },
    }, async (span) => {
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
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
        } catch (err: any) {
            console.error('❌ Turso logConversation error:', err, { model, role, user_id, chat_id, session_id, agent_id });
            // Record exception and set span status to ERROR
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            throw err;
        }
    });
  }

  public async getLatestConversationByuser_id(user_id: string) {
    // 1. Start Manual Span for Database Operation
    return tracer.startActiveSpan('TursoClient.getLatestConversationByuser_id', {
        attributes: {
            'db.system': DB_SYSTEM,
            'db.operation': 'SELECT',
            'db.collection.name': 'conversation_history',
            'db.query.summary': 'SELECT latest conversation by user_id',
        },
    }, async (span) => {
        const user_idStr = String(user_id);

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

        try {
            const res = await this.db.execute({
                sql: sql,
                args: [user_idStr],
            });
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return res.rows ?? [];
        } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            throw err;
        }
    });
  }

  public async getLatestConversationBySessionId(sessionId: string) {
    // 1. Start Manual Span for Database Operation
    return tracer.startActiveSpan('TursoClient.getLatestConversationBySessionId', {
        attributes: {
            'db.system': DB_SYSTEM,
            'db.operation': 'SELECT',
            'db.collection.name': 'conversation_history',
            'db.query.summary': 'SELECT conversation by session_id',
        },
    }, async (span) => {
        const sessionIdStr = String(sessionId);

        const sql = `
          SELECT
            *
          FROM
            conversation_history
          WHERE
            session_id = ?
          ORDER BY
            timestamp ASC
        `;

        try {
            const res = await this.db.execute({
                sql: sql,
                args: [sessionIdStr],
            });
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return res.rows ?? [];
        } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            throw err;
        }
    });
  }

  public async getSession(user_id: string): Promise<{ sessionId: string }> {
    // 1. Start Manual Span for Database Operation
    return tracer.startActiveSpan('TursoClient.getSession', {
        attributes: {
            'db.system': DB_SYSTEM,
            'db.operation': 'SELECT',
            'db.collection.name': 'conversation_history',
            'db.query.summary': 'SELECT latest session by user_id',
        },
    }, async (span) => {
        const user_idStr = String(user_id);

        const sql = `SELECT session_id, timestamp FROM conversation_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`;

        try {
            const res = await this.db.execute({
                sql: sql,
                args: [user_idStr],
            });
            const latest = res?.rows?.[0];
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            return { sessionId: String(latest.session_id) };
        } catch (err: any) {
            span.recordException(err);
            span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
            span.end();
            throw err;
        }
    });
  }
}

export const tursoClient = new TursoClient();