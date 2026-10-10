// CoachAdapter and TranscriberAdapter over the Worker, which holds the API key and the Coach brain prompts.
import type { AnswerAudio, CoachAdapter, CoachingPoint, TranscriberAdapter, Transcript } from "../engine/types";
import type { Log } from "./debug-log";

async function post<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": contentType }, body });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json() as Promise<T>;
}

/** Wraps 16 kHz mono PCM16 in a WAV header. */
function wav(pcm: ArrayBuffer) {
  const h = new DataView(new ArrayBuffer(44));
  const str = (at: number, s: string) => [...s].forEach((c, i) => h.setUint8(at + i, c.charCodeAt(0)));
  str(0, "RIFF"); h.setUint32(4, 36 + pcm.byteLength, true); str(8, "WAVE");
  str(12, "fmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  str(36, "data"); h.setUint32(40, pcm.byteLength, true);
  return new Blob([h.buffer, pcm], { type: "audio/wav" });
}

export function httpTranscriber(log: Log): TranscriberAdapter {
  let n = 0;
  return {
    async transcribe(audio: AnswerAudio) {
      const id = ++n;
      const t0 = performance.now();
      try {
        const t = await post<Transcript & { model?: string }>("/api/transcribe", wav(audio), "audio/wav");
        log(`transcript #${id} (${(audio.byteLength / 32000).toFixed(1)} s audio, ${Math.round(performance.now() - t0)} ms, ${t.model}${t.untimed ? ", no word timings" : `, ${t.words.length} words`}, debug only): ${t.text}`);
        return t;
      } catch (e) {
        log(`transcript #${id} FAILED after ${Math.round(performance.now() - t0)} ms: ${(e as Error).message}`);
        throw e;
      }
    },
  };
}

/** delayMs (test-only, ?coachDelay=) holds every answer back, to exercise the Partner's covering lines. */
export function httpCoach(log: Log, delayMs = 0): CoachAdapter {
  const timed = async <T>(what: string, run: () => Promise<T>) => {
    const t0 = performance.now();
    try {
      const [out] = await Promise.all([run(), new Promise((r) => setTimeout(r, delayMs))]);
      log(`Coach brain ${what} in ${Math.round(performance.now() - t0)} ms: ${JSON.stringify(out)}`);
      return out;
    } catch (e) {
      log(`Coach brain ${what} FAILED after ${Math.round(performance.now() - t0)} ms: ${(e as Error).message}`);
      throw e;
    }
  };
  return {
    coachingPoint(input) {
      log(`→ Coach brain: Coaching point for ${JSON.stringify(input)}`);
      return timed("Coaching point", () => post<CoachingPoint>("/api/coach/point", JSON.stringify(input), "application/json"));
    },
    betterVersion(input) {
      log(`→ Coach brain: Better version, Redo: ${input.redo}`);
      return timed("Better version", async () => (await post<{ text: string }>("/api/coach/better", JSON.stringify(input), "application/json")).text);
    },
    transferComment(input) {
      log(`→ Coach brain: Transfer comment for ${JSON.stringify(input)}`);
      return timed("Transfer comment", async () => (await post<{ text: string }>("/api/coach/transfer", JSON.stringify(input), "application/json")).text);
    },
    nextFocus(input) {
      log(`→ Coach brain: Next focus for ${JSON.stringify(input)}`);
      return timed("Next focus", async () => (await post<{ text: string }>("/api/coach/next-focus", JSON.stringify(input), "application/json")).text);
    },
    answerFirst(input) {
      log(`→ Coach brain: Answer first? for ${input.answers.length} Answers`);
      return timed("Answer first", async () => (await post<{ answerFirst: boolean[] }>("/api/coach/answer-first", JSON.stringify(input), "application/json")).answerFirst);
    },
  };
}
