// Mints a single-use ephemeral Live API token. The whole Live config is locked here; the browser can only add a
// sessionResumption handle. Resuming doesn't spend the token's one use, so one token covers a whole Session.
import type { Env } from "./env";

const API = "https://generativelanguage.googleapis.com";
export const LIVE_MODEL = "gemini-3.8-live";
const VOICE = "Charon";

// The Session engine steers the Partner with "[Director]" notes (see src/engine/session.ts).
const PARTNER_PROMPT = `You are the Partner in a live spoken-English practice call. The learner is a product manager and a non-native English speaker practising answers for meetings.

Tone: a senior colleague in a meeting who has two minutes. Polite, brisk, unconvinced by default. Normal speaking speed. Never agree just to be agreeable, and never praise.

Language: speak English only, always, whatever language the learner uses. This is English practice. If the learner speaks another language, do not answer in it: say in English, briefly, that we are keeping it in English, then ask your question in English.

How the call is run:
- The practice app directs the call with messages that start with "[Director]". They are not from the learner. Follow the latest one exactly. Never read them out, quote them, or mention them.
- Each time the learner finishes speaking, do exactly what the latest [Director] note says for your next turn. Respond to what the learner actually said.
- If the learner asks you to repeat or says they didn't catch the question, say your last question again word for word, and nothing else. This comes before the [Director] note, which then applies to your next turn.
- Keep every turn under 25 words, and ask at most one question per turn.
- The learner often pauses to think, sometimes for several seconds. Never fill silence, never say "take your time", never answer for them.
- Do not give feedback, tips or corrections. Only ask questions, unless a [Director] note tells you otherwise.
- If the learner interrupts you, stop and listen.`;

export async function mintLiveToken(env: Env): Promise<Response> {
  const now = Date.now();
  const authToken = {
    uses: 1,
    expireTime: new Date(now + 30 * 60e3).toISOString(),
    newSessionExpireTime: new Date(now + 2 * 60e3).toISOString(),
    bidiGenerateContentSetup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
      systemInstruction: { parts: [{ text: PARTNER_PROMPT }] },
      // ADR-0002: the browser decides when the learner's turn starts and ends.
      realtimeInputConfig: { automaticActivityDetection: { disabled: true }, activityHandling: "START_OF_ACTIVITY_INTERRUPTS" },
      contextWindowCompression: { slidingWindow: {} },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    fieldMask:
      "model,generationConfig,systemInstruction,realtimeInputConfig,contextWindowCompression,inputAudioTranscription,outputAudioTranscription",
  };
  const r = await fetch(`${API}/v1beta/auth_tokens`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify(authToken),
  });
  if (!r.ok) {
    return Response.json({ error: "token mint failed", status: r.status, detail: (await r.text()).slice(0, 1000) }, { status: 502 });
  }
  const t = await r.json<{ name: string }>();
  return Response.json({ token: t.name, model: LIVE_MODEL, expireTime: authToken.expireTime });
}
