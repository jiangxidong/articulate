import { Gate } from "./gate";
import { CallLogs, type LogUpload } from "./call-logs";
import { hasSession, safeEqual, sessionCookie } from "./auth";
import { mintLiveToken } from "./live-token";
import { transcribe } from "./transcribe";
import { answerFirst, betterVersion, coachingPoint, nextFocus, transferComment } from "./coach";
import type { Env } from "./env";

export { Gate, CallLogs };

const MAX_LOG_BYTES = 1_500_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env);
    if (!(await hasSession(request, env))) return Response.json({ error: "unauthorized" }, { status: 401 });

    if (url.pathname === "/api/me") return Response.json({ ok: true });
    if (url.pathname === "/api/token" && request.method === "POST") return mintLiveToken(env);
    if (url.pathname === "/api/transcribe" && request.method === "POST") return transcribe(request, env);
    if (url.pathname === "/api/coach/point" && request.method === "POST") return coachingPoint(request, env);
    if (url.pathname === "/api/coach/better" && request.method === "POST") return betterVersion(request, env);
    if (url.pathname === "/api/coach/transfer" && request.method === "POST") return transferComment(request, env);
    if (url.pathname === "/api/coach/next-focus" && request.method === "POST") return nextFocus(request, env);
    if (url.pathname === "/api/coach/answer-first" && request.method === "POST") return answerFirst(request, env);
    if (url.pathname === "/api/logs" && request.method === "POST") return putLog(request, env);
    if (url.pathname === "/api/logs" && request.method === "GET") return readLogs(url, env);
    return Response.json({ error: "not found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function login(request: Request, env: Env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const gate = singleton(env.GATE);
  const locked = await gate.lockedFor(ip);
  if (locked) return Response.json({ error: "locked", retryAfterSec: Math.ceil(locked / 1000) }, { status: 429 });

  const { passcode } = await request.json<{ passcode?: string }>().catch(() => ({ passcode: undefined }));
  if (!env.PASSCODE || !safeEqual(String(passcode ?? ""), env.PASSCODE)) {
    await gate.fail(ip);
    return Response.json({ error: "wrong passcode" }, { status: 401 });
  }
  await gate.succeed(ip);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": await sessionCookie(env) } });
}

/** Each Durable Object class here has one global instance. */
const singleton = <T extends Rpc.DurableObjectBranded | undefined>(ns: DurableObjectNamespace<T>) => ns.get(ns.idFromName("global"));
const logs = (env: Env) => singleton(env.LOGS);

async function putLog(request: Request, env: Env) {
  const body = await request.text();
  if (body.length > MAX_LOG_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let log: LogUpload;
  try {
    const j = JSON.parse(body);
    log = { id: String(j.id).slice(0, 80), startedAt: Number(j.startedAt) || Date.now(), userAgent: String(j.userAgent ?? "").slice(0, 300), text: String(j.text ?? "") };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  if (!log.id) return Response.json({ error: "missing id" }, { status: 400 });
  await logs(env).put(log);
  return Response.json({ ok: true });
}

// GET /api/logs?limit=3 → the latest calls' logs as plain text, newest first. ?list=1 → summaries only.
async function readLogs(url: URL, env: Env) {
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 3));
  const rows = await logs(env).recent(limit);
  if (url.searchParams.get("list")) return Response.json(rows.map(({ text, ...summary }) => summary));
  const text = rows
    .map((r) => `===== ${r.id} · started ${new Date(r.startedAt).toISOString()} · updated ${new Date(r.updatedAt).toISOString()}\n===== ${r.userAgent}\n${r.text}`)
    .join("\n\n");
  return new Response(text || "(no logs)", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
