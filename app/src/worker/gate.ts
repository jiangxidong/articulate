import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

// Failed-passcode limiter. One global instance, so rotating IPs doesn't help.
// Per IP: 5 failures lock that IP out for 15 min. Globally: 20 failures in an hour lock everyone out for 15 min.
const PER_IP_MAX = 5;
const GLOBAL_MAX = 20;
const LOCK_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

interface Row { count: number; first_at: number; locked_until: number }

export class Gate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS fails (key TEXT PRIMARY KEY, count INTEGER, first_at INTEGER, locked_until INTEGER)",
    );
  }

  private row(key: string): Row | undefined {
    return this.ctx.storage.sql.exec<Row & Record<string, number>>("SELECT * FROM fails WHERE key = ?", key).toArray()[0];
  }

  /** Milliseconds left on a lockout for this IP or for everyone, or 0. */
  async lockedFor(ip: string) {
    const now = Date.now();
    const left = (r?: Row) => (r && r.locked_until > now ? r.locked_until - now : 0);
    return Math.max(left(this.row("ip:" + ip)), left(this.row("global")));
  }

  async fail(ip: string) {
    const now = Date.now();
    this.bump("ip:" + ip, now, PER_IP_MAX, Infinity);
    this.bump("global", now, GLOBAL_MAX, GLOBAL_WINDOW_MS);
  }

  async succeed(ip: string) {
    this.ctx.storage.sql.exec("DELETE FROM fails WHERE key = ?", "ip:" + ip);
  }

  private bump(key: string, now: number, max: number, windowMs: number) {
    let r = this.row(key);
    if (!r || (r.locked_until && r.locked_until <= now) || now - r.first_at > windowMs) {
      r = { count: 0, first_at: now, locked_until: 0 };
    }
    const count = r.count + 1;
    const lockedUntil = count >= max ? now + LOCK_MS : 0;
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO fails (key, count, first_at, locked_until) VALUES (?, ?, ?, ?)",
      key, lockedUntil ? 0 : count, r.first_at, lockedUntil,
    );
  }
}
