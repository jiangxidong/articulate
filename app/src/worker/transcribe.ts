// POST /api/transcribe: one Answer's audio (WAV) → verbatim transcript with word timings, via gemini-3.5-transcribe
// on the Interactions API (docs/research/gemini-stack-2026-10.md §4). If that fails, a general model transcribes it
// instead, fillers kept but without word timings: since 2026-10-07 gemini-3.5-transcribe rejects every request with
// "Thinking is not enabled for this model", and without a transcript no Coaching point can be chosen.
import type { Transcript } from "../engine/types";
import type { Env } from "./env";
import { API, postGemini, upstreamError } from "./gemini-api";

const MODEL = "gemini-3.5-transcribe";
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_PROMPT =
  "Transcribe this recording of one speaker exactly as spoken, in English. It is for counting filler words, so keep every filler (um, uh, er, like, you know, I mean), repetition, false start and unfinished word exactly where it was said. Do not correct grammar, do not tidy, do not summarise. Output only the transcript text, nothing else.";
const MAX_BYTES = 15e6;

interface Interaction {
  id?: string;
  status?: string;
  steps?: { content?: { type: string; text?: string; annotations?: { type: string; text: string; start_offset: string; end_offset: string }[] }[] }[];
}

const ms = (offset: string) => Math.round(parseFloat(offset) * 1000);

export async function transcribe(request: Request, env: Env): Promise<Response> {
  const mime = (request.headers.get("content-type") || "audio/wav").split(";")[0];
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const data = btoa(bin);

  const primary = await verbatim(data, mime, env);
  if (primary.ok) return primary;
  console.log(`transcribe: ${MODEL} failed (${primary.status}: ${(await primary.clone().text()).slice(0, 200)}), using ${FALLBACK_MODEL}`);
  const fallback = await plain(data, mime, env);
  return fallback.ok ? fallback : primary;
}

/** gemini-3.5-transcribe: verbatim, with word timings. */
async function verbatim(audio: string, mime: string, env: Env): Promise<Response> {
  const r = await postGemini("/v1beta/interactions", {
    model: MODEL,
    input: [{ type: "audio", data: audio, mime_type: mime }],
    generation_config: {
      transcription_config: { language_codes: ["en-US"], mode: { type: "verbatim", timestamp_granularities: ["word"] } },
    },
  }, env);
  if (!r.ok) return upstreamError("transcribe", r);
  let data = await r.json<Interaction>();
  // In case the interaction comes back still running, poll it briefly.
  for (let i = 0; i < 30 && data.id && data.status && data.status !== "completed" && data.status !== "failed"; i++) {
    await new Promise((res) => setTimeout(res, 500));
    const p = await fetch(`${API}/v1beta/${data.id.startsWith("interactions/") ? data.id : `interactions/${data.id}`}`, {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    });
    if (!p.ok) break;
    data = await p.json<Interaction>();
  }
  if (data.status && data.status !== "completed") return Response.json({ error: `transcribe ${data.status}` }, { status: 502 });
  const contents = (data.steps ?? []).flatMap((s) => s.content ?? []).filter((c) => c.type === "text");
  const transcript: Transcript = {
    text: contents.map((c) => c.text ?? "").join("").trim(),
    words: contents.flatMap((c) => (c.annotations ?? []).filter((a) => a.type === "word_info"))
      .map((a) => ({ text: a.text, startMs: ms(a.start_offset), endMs: ms(a.end_offset) })),
  };
  return Response.json({ ...transcript, model: MODEL });
}

/** The fallback: the words with their fillers, but no word timings. */
async function plain(audio: string, mime: string, env: Env): Promise<Response> {
  const r = await postGemini(`/v1beta/models/${FALLBACK_MODEL}:generateContent`, {
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: audio } }, { text: FALLBACK_PROMPT }] }],
  }, env);
  if (!r.ok) return upstreamError("transcribe fallback", r);
  const d = await r.json<{ candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }>();
  const text = (d.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  // No word timings: the metrics transcribe it again after the Session (Transcript.untimed).
  return Response.json({ text, words: [], untimed: true, model: FALLBACK_MODEL } satisfies Transcript & { model: string });
}
