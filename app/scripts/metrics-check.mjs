// Ticket 08: are the speech metrics right on real audio? Each clip (the fake-mic Answers, the follow-up clips and
// test/metrics/) is cut the way the call cuts it (the turn opens after 3 loud 40 ms frames, with 320 ms of pre-roll),
// transcribed by the Worker's own transcribe.ts (gemini-3.5-transcribe, verbatim, word timings; its fallback as live),
// measured by src/engine/metrics.ts and judged by the Worker's answerFirst, one request per "Session" of clips as live.
// The counts are compared with the same metrics run on each clip's script, and the first-sentence verdicts with a label
// written by hand against the course's skeleton.
//
//   node scripts/metrics-check.mjs [runs=3]
//
// Reads GEMINI_API_KEY from the repo root's .env (never prints it). Writes every transcript and count to
// test/metrics/results-<time>.json and prints a summary.
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = Number(process.argv[2] ?? 3);
const ENV = [join(APP, "..", ".env"), join(execSync("git rev-parse --git-common-dir", { cwd: APP, encoding: "utf8" }).trim(), "..", ".env")]
  .map((p) => (p.startsWith("/") ? p : join(APP, p)))
  .find(existsSync);
const KEY = readFileSync(ENV, "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("GEMINI_API_KEY not found in .env");
const env = { GEMINI_API_KEY: KEY };

async function load(file) {
  const out = join(mkdtempSync(join(tmpdir(), "metrics-")), "m.mjs");
  await build({ entryPoints: [join(APP, file)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
  return import(pathToFileURL(out).href);
}
const { transcribe } = await load("src/worker/transcribe.ts");
const { answerFirst } = await load("src/worker/coach.ts");
const { measureSession } = await load("src/engine/metrics.ts");

const LAPTOPS = "The owner is thinking about banning laptops on weekends, from 9 to 2. Good idea or not? What's your call?";
const CASH = "Should cafés stop taking cash completely? Yes or no — and why?";
const RESERVATIONS = "Should restaurants stop taking reservations and go walk-in only?";
// answerFirst: my label against the skeleton (the Answer is the first sentence of substance); null where it's arguable.
const SESSIONS = [
  [
    { clip: "fake-mic/01-main-pause.wav", kind: "main", question: LAPTOPS, answerFirst: true },
    { clip: "fake-mic/02-done.wav", kind: "followUp", question: "What's the single strongest reason?", answerFirst: true },
    { clip: "fake-mic/03-barge-in.wav", kind: "followUp", question: "What about the regulars who work there on weekdays?", answerFirst: true },
    { clip: "fake-mic/04-filler-pause.wav", kind: "followUp", question: "What would make you change your mind?", answerFirst: true },
    { clip: "fake-mic/08-r2-main.wav", kind: "main", question: CASH, answerFirst: true },
    { clip: "fake-mic/09-r2-fu1.wav", kind: "followUp", question: "Is there any situation where you'd say the opposite?", answerFirst: true },
    { clip: "fake-mic/10-r2-fu2.wav", kind: "followUp", question: "Put a number on it — how much time or money are we talking about?", answerFirst: true },
    { clip: "fake-mic/11-r2-fu3.wav", kind: "followUp", question: "What about an older customer who only carries cash?", answerFirst: true },
    { clip: "fake-mic/13-transfer.wav", kind: "transfer", question: RESERVATIONS, answerFirst: false },
  ],
  [
    { clip: "follow-up/hedge-size.wav", kind: "main", question: LAPTOPS, answerFirst: false },
    { clip: "follow-up/like-i-said.wav", kind: "followUp", question: "But what about a big café that's still full every weekend?", answerFirst: false },
    { clip: "follow-up/one-line.wav", kind: "main", question: LAPTOPS, answerFirst: null },
    { clip: "follow-up/number.wav", kind: "followUp", question: "Put a number on it — how much revenue are we talking about?", answerFirst: true },
    { clip: "metrics/first-read.wav", kind: "main", question: LAPTOPS, answerFirst: true },
    { clip: "metrics/question-is-whether.wav", kind: "main", question: LAPTOPS, answerFirst: true },
    { clip: "metrics/not-assessed.wav", kind: "main", question: LAPTOPS, answerFirst: true },
    { clip: "metrics/like-verb.wav", kind: "main", question: LAPTOPS, answerFirst: true },
    { clip: "metrics/background-first.wav", kind: "main", question: LAPTOPS, answerFirst: false },
  ],
];

const SCRIPTS = Object.fromEntries(["fake-mic", "follow-up", "metrics"].flatMap((dir) =>
  [...readFileSync(join(APP, "test", dir, "make-clips.sh"), "utf8").matchAll(/^gen (\S+) "(.*)"$/gm)]
    .map(([, file, text]) => [`${dir}/${file}`, text.replace(/\[\[slnc \d+\]\]\s*/g, "")])));

/** 24 kHz 16-bit mono WAV → 16 kHz PCM16 (linear interpolation), as the capture worklet sends it. */
function clipPcm16k(path) {
  const buf = readFileSync(join(APP, "test", path));
  let off = 12, data, rate;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") rate = buf.readUInt32LE(off + 12);
    if (id === "data") data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  const src = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  const n = Math.floor((src.length * 16000) / rate);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * rate) / 16000, j = Math.floor(x), f = x - j;
    out[i] = Math.round(src[j] * (1 - f) + (src[Math.min(j + 1, src.length - 1)] ?? 0) * f);
  }
  return out;
}

// The call's own turn detection settings: 40 ms frames of 16 kHz audio.
const { DEFAULT_TURN_SETTINGS: TURN } = await load("src/client/live/turn-detector.ts");
const FRAME = 640, SPEECH_RMS = TURN.speechRms, OPEN_FRAMES = TURN.openFrames, PREROLL_FRAMES = TURN.prerollFrames;
const rms = (pcm, f) => {
  let s = 0;
  for (let i = f * FRAME; i < (f + 1) * FRAME; i++) s += (pcm[i] / 32768) ** 2;
  return Math.sqrt(s / FRAME);
};

/** The turn as the call would send it: from 320 ms before it opens. onsetMs: where the first loud frame is in that audio. */
function asTurn(pcm) {
  const frames = Math.floor(pcm.length / FRAME);
  let run = 0, open = -1, lastLoud = 0;
  for (let f = 0; f < frames; f++) {
    const loud = rms(pcm, f) > SPEECH_RMS;
    if (open < 0) {
      run = loud ? run + 1 : 0;
      if (run === OPEN_FRAMES) open = f;
    } else if (loud) lastLoud = f;
  }
  const from = Math.max(0, open + 1 - PREROLL_FRAMES);
  const onset = open - OPEN_FRAMES + 1;
  return { pcm: pcm.subarray(from * FRAME), onsetMs: (onset - from) * 40, speechMs: (lastLoud - open) * 40 };
}

function wav(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/** The script's words with made-up timings: what the metrics would say on a perfect transcript (timings aside). */
const scripted = (text) => ({ text, words: text.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, startMs: i * 300, endMs: i * 300 + 300 })) });

const coach = (log) => ({
  async answerFirst(input) {
    const t0 = Date.now();
    const r = await answerFirst(new Request("http://coach", { method: "POST", body: JSON.stringify(input) }), env);
    const j = await r.json();
    log.answerFirstMs = Date.now() - t0;
    if (!r.ok) throw new Error(j.error);
    return j.answerFirst;
  },
});
const noJudge = { answerFirst: async (input) => input.answers.map(() => true) };

const turns = Object.fromEntries(SESSIONS.flat().map((c) => [c.clip, asTurn(clipPcm16k(c.clip))]));
const results = [];
for (let run = 1; run <= RUNS; run++) {
  for (const [s, session] of SESSIONS.entries()) {
    // gemini-3.5-transcribe allows 10 requests a minute on this key's tier: one every 6.5 s.
    const transcripts = await Promise.all(session.map(async (c, i) => {
      await new Promise((r) => setTimeout(r, i * 6500));
      const t0 = Date.now();
      try {
        const r = await transcribe(new Request("http://t", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav(turns[c.clip].pcm) }), env);
        const t = await r.json();
        return { ...t, ms: Date.now() - t0, ok: r.ok };
      } catch (e) {
        // A dropped connection: counted as a failed transcription, as the app would see it.
        return { text: "", words: [], error: e.message, ms: Date.now() - t0, ok: false };
      }
    }));
    const log = {};
    const answers = session.map((c, i) => ({
      kind: c.kind, question: c.question, startedAfterMs: 0, turns: [{ speechMs: turns[c.clip].speechMs, transcript: transcripts[i] }],
    }));
    const timed = transcripts.every((t) => t.ok && !t.untimed);
    const measured = timed ? await measureSession(answers, coach(log)) : null;
    const expected = await measureSession(session.map((c) => ({
      kind: c.kind, question: c.question, startedAfterMs: 0, turns: [{ speechMs: turns[c.clip].speechMs, transcript: scripted(SCRIPTS[c.clip]) }],
    })), noJudge);
    await new Promise((r) => setTimeout(r, 6500));
    results.push({
      run, session: s + 1, answerFirstMs: log.answerFirstMs,
      clips: session.map((c, i) => {
        const t = transcripts[i], m = measured?.answers[i], e = expected.answers[i];
        const firstWord = t.words?.[0];
        return {
          clip: c.clip, question: c.question, script: SCRIPTS[c.clip], transcript: t.text, model: t.model, untimed: !!t.untimed, failed: !t.ok, transcribeMs: t.ms,
          onsetMs: turns[c.clip].onsetMs, firstWordMs: firstWord?.startMs, firstSubstanceMs: m?.latencyMs,
          fillers: m?.fillers, fillersScript: e.fillers, holding: m?.holdingPhrases, holdingScript: e.holdingPhrases,
          answerFirst: m?.answerFirst, answerFirstLabel: c.answerFirst,
        };
      }),
    });
  }
  process.stdout.write(`run ${run} done\n`);
}

const out = join(APP, "test/metrics", `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(out, JSON.stringify(results, null, 2));

const all = results.flatMap((r) => r.clips);
const timedClips = all.filter((c) => c.fillers !== undefined);
const count = (f) => all.filter(f).length;
console.log(`\n${all.length} transcriptions (${SESSIONS.flat().length} clips × ${RUNS} runs): ${count((c) => !c.untimed && !c.failed)} by ${all.find((c) => !c.untimed && !c.failed)?.model}, ${count((c) => c.untimed)} by the fallback, ${count((c) => c.failed)} failed (that Session's run not measured)`);
console.log(`transcription time median ${median(all.map((c) => c.transcribeMs))} ms; answerFirst ${results.map((r) => r.answerFirstMs).join(", ")} ms`);
console.log(`first word − speech onset (ms): ${summary(timedClips.map((c) => c.firstWordMs - c.onsetMs))}`);
console.log(`fillers: transcript ${sum(timedClips.map((c) => c.fillers))} vs script ${sum(timedClips.map((c) => c.fillersScript))}; clips where they match ${timedClips.filter((c) => c.fillers === c.fillersScript).length}/${timedClips.length}`);
console.log(`holding phrases: transcript ${sum(timedClips.map((c) => c.holding))} vs script ${sum(timedClips.map((c) => c.holdingScript))}; match ${timedClips.filter((c) => c.holding === c.holdingScript).length}/${timedClips.length}`);
const labelled = timedClips.filter((c) => c.answerFirstLabel !== null && c.answerFirst !== undefined);
console.log(`answer first: agrees with the label ${labelled.filter((c) => c.answerFirst === c.answerFirstLabel).length}/${labelled.length}`);
console.log("\nper clip (all runs): fillers transcript/script · holding · first substance − onset (ms) · answer first (label)");
for (const clip of SESSIONS.flat()) {
  const cs = timedClips.filter((c) => c.clip === clip.clip);
  console.log(`${clip.clip.padEnd(32)} ${cs.map((c) => c.fillers).join(",")}/${cs[0]?.fillersScript} · ${cs.map((c) => c.holding).join(",")}/${cs[0]?.holdingScript} · ${cs.map((c) => (c.firstSubstanceMs === undefined ? "–" : c.firstSubstanceMs - c.onsetMs)).join(",")} · ${cs.map((c) => c.answerFirst).join(",")} (${clip.answerFirst})`);
}
console.log(`\nwrote ${out}`);

function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
function summary(xs) { const s = [...xs].sort((a, b) => a - b); return `median ${median(s)}, min ${s[0]}, max ${s.at(-1)}`; }
