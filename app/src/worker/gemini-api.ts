import type { Env } from "./env";

export const API = "https://generativelanguage.googleapis.com";

/** POSTs JSON to the Gemini API, retrying the occasional 503 / 429. */
export async function postGemini(path: string, body: unknown, env: Env): Promise<Response> {
  const send = () =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    });
  let r = await send();
  for (let i = 0; i < 2 && (r.status === 503 || r.status === 429); i++) {
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    r = await send();
  }
  return r;
}

export const upstreamError = async (what: string, r: Response) =>
  Response.json({ error: `${what} failed`, status: r.status, detail: (await r.text()).slice(0, 1000) }, { status: 502 });
