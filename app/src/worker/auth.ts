// Signed session cookie "<expiryMs>.<hmac>", HMAC-SHA256 with SESSION_SECRET. Set after a correct passcode.
import type { Env } from "./env";

const COOKIE = "bl_session";
const TTL_MS = 30 * 24 * 3600 * 1000;
const enc = new TextEncoder();

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function sessionCookie(env: Env) {
  const exp = String(Date.now() + TTL_MS);
  const sig = await hmac(env.SESSION_SECRET, exp);
  return `${COOKIE}=${exp}.${sig}; Path=/; Max-Age=${TTL_MS / 1000}; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasSession(request: Request, env: Env) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await hmac(env.SESSION_SECRET, exp));
}
