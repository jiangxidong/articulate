// Ticket 07: does the Partner say the new opening (the Thinking pattern's one-sentence introduction, alone or after
// the Next focus reminder) word for word? And after it, does the Partner still only ask its Follow-up, with no
// feedback on the pattern? Opens gemini-3.8-live directly with the Worker's Live config, as follow-up-check.mjs does.
//
//   node scripts/opening-check.mjs [runs=4] [concurrency=4]
//   node scripts/opening-check.mjs sample     # writes public/partner-sample.wav (the mic check's echo test)
//
// Reads GEMINI_API_KEY from the repo root's .env (never prints it). Writes the replies to
// test/opening/results-<time>.json and prints a summary.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = process.argv[2] === "sample";
const RUNS = SAMPLE ? 1 : Number(process.argv[2] ?? 4);
const CONCURRENCY = Number(process.argv[3] ?? 4);

const ENV = [join(APP, "..", ".env"), join(execSync("git rev-parse --git-common-dir", { cwd: APP, encoding: "utf8" }).trim(), "..", ".env")]
  .map((p) => (p.startsWith("/") ? p : join(APP, p)))
  .find(existsSync);
const KEY = readFileSync(ENV, "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("GEMINI_API_KEY not found in .env");

const liveToken = readFileSync(join(APP, "src/worker/live-token.ts"), "utf8");
const PARTNER_PROMPT = liveToken.match(/const PARTNER_PROMPT = `([\s\S]*?)`;/)[1];
const LIVE_MODEL = liveToken.match(/LIVE_MODEL = "(.*?)"/)[1];
const VOICE = liveToken.match(/VOICE = "(.*?)"/)[1];

// Mirror src/content/practice.ts and openingLine() in src/engine/session.ts.
const practice = readFileSync(join(APP, "src/content/practice.ts"), "utf8");
const INTROS = [...practice.matchAll(/intro: "(.*?)",/g)].map((m) => m[1]);
if (INTROS.length !== 3) throw new Error("couldn't read the three pattern intros from practice.ts");
// A Next focus of the length the Coach brain now writes (at most ~12 words).
const FOCUS = "Give your yes or no in your very first sentence.";
const MAIN = "The owner is thinking about banning laptops on weekends, from 9 to 2. Good idea or not? What's your call?";
const FOLLOW_UP_NOTE =
  `[Director] When the learner finishes this answer, ask one Follow-up of type "Why": ask for the single strongest reason behind what they just said. ` +
  `Build it on one specific thing they just said (a word, a number, an example, or a condition such as "it depends on…"). ` +
  `Never ask a generic question that would fit any answer, and never assume a side they didn't take. ` +
  `If their answer made no call (for example "it depends on…" with both sides left open), shape this same ` +
  `"Why" question so that answering it forces them to make the call for this case. ` +
  `If they did make a call, don't ask them to choose a side.`;
const sayExactly = (text) => `[Director] Say exactly this, word for word, and nothing else: "${text}"`;

const CASES = SAMPLE
  ? [{ name: "sample", opening: "Hi, this is how I'll sound on the call. If you can hear me echo back on your speaker, put on headphones." }]
  : [
    ...INTROS.map((intro, i) => ({ name: `intro ${i + 1}`, opening: `Hi. ${intro}` })),
    { name: "focus + intro 1", opening: `Hi. Your focus from last time: ${FOCUS} ${INTROS[0]}` },
    { name: "focus only", opening: `Hi. Your focus from last time: ${FOCUS}` },
  ];

/** 24 kHz 16-bit mono WAV → 16 kHz PCM16 (linear interpolation). */
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

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One Live session: the opening, then (not for the sample) the Main question and the reply to an Answer clip. */
async function runCase(c) {
  const ws = new WebSocket(
    `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`,
  );
  ws.binaryType = "arraybuffer";
  let onTurn = null, out = "", setupDone;
  const audio = [];
  const ready = new Promise((r) => (setupDone = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8"));
    if (m.setupComplete) setupDone();
    const sc = m.serverContent;
    if (sc?.outputTranscription?.text) out += sc.outputTranscription.text;
    for (const p of sc?.modelTurn?.parts ?? []) if (p.inlineData?.data) audio.push(Buffer.from(p.inlineData.data, "base64"));
    if (sc?.turnComplete && onTurn) onTurn();
  };
  const closed = new Promise((_, rej) => (ws.onclose = (e) => rej(new Error(`closed ${e.code} ${e.reason}`))));
  closed.catch(() => {});
  await new Promise((r, rej) => ((ws.onopen = r), (ws.onerror = () => rej(new Error("ws error")))));
  const send = (m) => ws.send(JSON.stringify(m));
  send({
    setup: {
      model: `models/${LIVE_MODEL}`,
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
      systemInstruction: { parts: [{ text: PARTNER_PROMPT }] },
      realtimeInputConfig: { automaticActivityDetection: { disabled: true }, activityHandling: "START_OF_ACTIVITY_INTERRUPTS" },
      contextWindowCompression: { slidingWindow: {} },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
  const turn = () => {
    let timer;
    const timeout = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("no turnComplete")), 30_000)));
    return Promise.race([closed, new Promise((r) => (onTurn = r)), timeout]).finally(() => clearTimeout(timer));
  };
  await Promise.race([ready, closed]);

  send({ clientContent: { turns: [{ role: "user", parts: [{ text: sayExactly(c.opening) }] }], turnComplete: true } });
  await turn();
  const opening = out.trim();
  out = "";
  if (SAMPLE) {
    ws.onclose = null;
    ws.close();
    return { opening, audio: Buffer.concat(audio) };
  }

  send({ clientContent: { turns: [{ role: "user", parts: [{ text: sayExactly(`First question. ${MAIN}`) }] }], turnComplete: true } });
  await turn();
  const main = out.trim();
  out = "";
  send({ clientContent: { turns: [{ role: "user", parts: [{ text: FOLLOW_UP_NOTE }] }], turnComplete: false } });
  await sleep(300);
  const pcm = clipPcm16k("fake-mic/01-main-pause.wav");
  const reply = turn();
  send({ realtimeInput: { activityStart: {} } });
  for (let i = 0; i < pcm.length; i += 640) {
    const part = pcm.subarray(i, i + 640);
    send({ realtimeInput: { audio: { data: Buffer.from(part.buffer, part.byteOffset, part.byteLength).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
    await sleep(40);
  }
  send({ realtimeInput: { activityEnd: {} } });
  await reply;
  ws.onclose = null;
  ws.close();
  return { opening, main, followUp: out.trim() };
}

const norm = (t) => (t.toLowerCase().replace(/’/g, "'").match(/[a-z0-9']+/g) ?? []).join(" ");
/** Word for word, ignoring case and punctuation. */
const verbatim = (said, line) => norm(said) === norm(line);
/** Feedback on the pattern in the Follow-up (it should only ask a question). */
const patternTalk = (t) => /pattern|two reasons|your position first|first sentence/i.test(t);

const jobs = CASES.flatMap((c) => Array.from({ length: RUNS }, (_, i) => ({ c, run: i + 1 })));
const results = [];
let next = 0, failed = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    let r;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try {
        r = await runCase(job.c);
      } catch (e) {
        console.error(`${job.c.name} #${job.run}: ${e.message}${attempt ? "" : " (retrying)"}`);
      }
    }
    if (!r) {
      failed++;
      continue;
    }
    if (SAMPLE) {
      writeFileSync(join(APP, "public/partner-sample.wav"), wav(r.audio, 24000));
      console.log(`said: ${r.opening}\nwrote public/partner-sample.wav (${(r.audio.length / 48000).toFixed(1)} s)`);
      continue;
    }
    const row = {
      case: job.c.name, run: job.run, ...r,
      openingVerbatim: verbatim(r.opening, job.c.opening),
      mainVerbatim: verbatim(r.main, `First question. ${MAIN}`),
      followUpTalksPattern: patternTalk(r.followUp),
    };
    results.push(row);
    console.log(`[${row.case} #${row.run}] opening ${row.openingVerbatim ? "verbatim" : `DIFFERS: ${r.opening}`} · main ${row.mainVerbatim ? "verbatim" : `DIFFERS: ${r.main}`}\n    follow-up: ${r.followUp}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (SAMPLE) process.exit(failed ? 1 : 0);

mkdirSync(join(APP, "test/opening"), { recursive: true });
const file = join(APP, "test/opening", `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
console.log("\ncase | runs | opening verbatim | main question verbatim | follow-up talks about the pattern");
for (const c of CASES) {
  const rs = results.filter((r) => r.case === c.name);
  const n = (f) => rs.filter(f).length;
  console.log(`${c.name} | ${rs.length} | ${n((r) => r.openingVerbatim)} | ${n((r) => r.mainVerbatim)} | ${n((r) => r.followUpTalksPattern)}`);
}
console.log(`\n${failed ? `${failed} case(s) failed twice and are left out. ` : ""}${file}`);
