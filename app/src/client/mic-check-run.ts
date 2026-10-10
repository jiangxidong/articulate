// Runs the onboarding mic check in the browser, with the call's own mic settings and capture path, so the levels it
// measures are the ones the turn detector will see: a quiet room, the learner speaking, then the Partner's voice played
// on the speaker (public/partner-sample.wav, Charon via the Live API) to measure its echo.
import { MIC_CONSTRAINTS, startCapture, setPlayAndRecord } from "./audio/capture";
import type { Log } from "./debug-log";
import { assessMic, type MicCheckResult } from "./mic-check";

export type MicCheckPhase = "quiet" | "speech" | "echo";

/** Lets auto gain control settle before measuring. */
const SETTLE_MS = 600;
const QUIET_MS = 3000;
const SPEECH_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Must start from a tap (the AudioContext and the mic prompt need it). */
export async function runMicCheck(h: { level(rms: number): void; phase(p: MicCheckPhase): void; log: Log }): Promise<MicCheckResult> {
  const audioSession = setPlayAndRecord();
  const ctx = new AudioContext();
  let stream: MediaStream | undefined;
  let stop: (() => void) | undefined;
  try {
    await ctx.resume();
    const sample = fetch("partner-sample.wav").then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b));
    stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    let into: number[] | null = null;
    stop = await startCapture(ctx, ctx.createMediaStreamSource(stream), (f) => {
      h.level(f.rms);
      into?.push(f.rms);
    });
    const record = async (phase: MicCheckPhase, run: () => Promise<unknown>) => {
      h.phase(phase);
      const levels: number[] = [];
      into = levels;
      await run();
      into = null;
      return levels;
    };
    await sleep(SETTLE_MS);
    const quiet = await record("quiet", () => sleep(QUIET_MS));
    const speech = await record("speech", () => sleep(SPEECH_MS));
    const buffer = await sample;
    const echo = await record("echo", () => new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => resolve();
      src.start();
    }));
    const result = assessMic({ quiet, speech, echo });
    h.log(`mic check (audioSession ${audioSession}): ${JSON.stringify(result)}`);
    return result;
  } finally {
    stop?.();
    stream?.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }
}
