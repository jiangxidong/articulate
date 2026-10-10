import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

// Debug logs uploaded by the call page, one row per call (keyed by the log id), so test calls can be read back without copy-paste.
const KEEP = 40;

export interface LogUpload {
  id: string;
  startedAt: number;
  userAgent: string;
  text: string;
}

export interface LogSummary {
  id: string;
  startedAt: number;
  updatedAt: number;
  userAgent: string;
  bytes: number;
}

export class CallLogs extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, started_at INTEGER, updated_at INTEGER, user_agent TEXT, text TEXT)",
    );
  }

  /** Each upload carries the whole log so far and replaces the previous one for that call. */
  async put(log: LogUpload) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO logs (id, started_at, updated_at, user_agent, text) VALUES (?, ?, ?, ?, ?)",
      log.id, log.startedAt, Date.now(), log.userAgent, log.text,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY started_at DESC LIMIT ?)", KEEP,
    );
  }

  async recent(limit: number): Promise<(LogSummary & { text: string })[]> {
    return this.ctx.storage.sql
      .exec<{ id: string; started_at: number; updated_at: number; user_agent: string; text: string }>(
        "SELECT * FROM logs ORDER BY started_at DESC LIMIT ?", limit,
      )
      .toArray()
      .map((r) => ({
        id: r.id, startedAt: r.started_at, updatedAt: r.updated_at, userAgent: r.user_agent, bytes: r.text.length, text: r.text,
      }));
  }
}
