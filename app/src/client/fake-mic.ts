// Test-only fake mic (?fakeMic=1): plays pre-recorded learner Answers into the same capture pipeline as the real
// mic, without getUserMedia. A script in /test/fake-mic/script.json says which clip answers which Partner question
// (covering lines and the Better version get no answer; entries are taken in order per Round and kind: Answers,
// "for": "redo", and "for": "transfer"), whether it starts after the Partner finishes or cuts in while it's talking,
// and whether the learner then taps Done or just goes quiet. After a Better version it taps Next once readMs is up.
import type { RoundNumber, Session, ThreadItem } from "../engine/types";
import type { Log } from "./debug-log";

const BASE = "test/fake-mic/";

interface ScriptEntry {
  /** What this Answer is meant to test, for the log. */
  note: string;
  clip: string;
  start: "afterPartner" | "duringPartner";
  delayMs: number;
  end: "done" | "silence";
  /** The Redo after the Coaching point, or the Answer to the Transfer question. Otherwise an Answer in the Round. */
  for?: "redo" | "transfer";
  /** Default 1. */
  round?: RoundNumber;
}

type Kind = "answer" | "redo" | "transfer";

/** A Partner turn the learner answers, and which kind of answer it takes. */
function answering(item: ThreadItem | undefined): Kind | null {
  if (item?.kind === "coaching" || (item?.kind === "partner" && item.step === "redo")) return "redo";
  if (item?.kind === "partner" && item.step === "transfer") return "transfer";
  if (item?.kind === "partner" && (item.step === "main" || item.step === "followUp")) return "answer";
  return null;
}

/** thinkMs: extra silence before each Answer that starts after the Partner. readMs: overrides the script's reading time. */
export async function createFakeMic(ctx: AudioContext, log: Log, opts: { thinkMs?: number; readMs?: number } = {}) {
  const script = (await (await fetch(BASE + "script.json")).json()) as { readMs: number; answers: ScriptEntry[] };
  const thinkMs = opts.thinkMs ?? 0;
  const readMs = opts.readMs ?? script.readMs;
  const clips = new Map<string, AudioBuffer>();
  for (const e of script.answers) {
    if (!clips.has(e.clip)) clips.set(e.clip, await ctx.decodeAudioData(await (await fetch(BASE + e.clip)).arrayBuffer()));
  }
  log(`fake mic: ${script.answers.length} scripted Answers loaded`);
  const output = ctx.createGain();

  /** Starts answering Partner questions. `tapDone` and `tapNext` must go through the same path as the buttons. */
  function drive(session: Session, tapDone: () => void, tapNext: () => void) {
    const queues = new Map<string, ScriptEntry[]>();
    for (const e of script.answers) {
      const key = `${e.for === "transfer" ? 0 : e.round ?? 1}:${e.for ?? "answer"}`;
      queues.set(key, [...(queues.get(key) ?? []), e]);
    }
    let reading = false;
    let threadLength = 0;
    let current: ScriptEntry | undefined;
    let played = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const play = (e: ScriptEntry) => {
      played = true;
      const src = ctx.createBufferSource();
      src.buffer = clips.get(e.clip)!;
      src.connect(output);
      src.onended = () => {
        log(`fake mic: finished ${e.clip}${e.end === "done" ? " → tapping Done" : " → going quiet"}`);
        if (e.end === "done") timers.push(setTimeout(tapDone, 300));
      };
      log(`fake mic: playing ${e.clip} (${src.buffer.duration.toFixed(1)} s) — ${e.note}`);
      src.start();
    };

    return session.subscribe((view) => {
      const grew = view.thread.length > threadLength;
      threadLength = view.thread.length;
      if (grew && view.activity === "partnerSpeaking") {
        const kind = answering(view.thread.at(-1));
        if (kind) {
          const round = kind === "transfer" || !view.step || !("round" in view.step) ? 0 : view.step.round;
          current = queues.get(`${round}:${kind}`)?.shift();
          if (!current) log(`fake mic: no scripted ${kind} left for round ${round}; staying quiet`);
          played = false;
          if (current?.start === "duringPartner") {
            const e = current;
            timers.push(setTimeout(() => play(e), e.delayMs));
          }
        }
      }
      if (view.canNext && !reading) {
        reading = true;
        log(`fake mic: reading the Better version for ${readMs} ms, then Next`);
        timers.push(setTimeout(() => { reading = false; if (session.view().canNext) tapNext(); }, readMs));
      }
      if (view.activity === "yourTurn" && !played && current?.start === "afterPartner") {
        const e = current;
        played = true;
        timers.push(setTimeout(() => play(e), e.delayMs + thinkMs));
      }
    });
  }

  return { source: output as AudioNode, drive };
}
