// Ticket 09: does the Follow-up note make the Partner build its Follow-up on the learner's Answer?
// Opens gemini-3.8-live directly with the Worker's Live config, plays each case (Main question → Follow-up note → Answer
// clip) under the old and the new note, and scores each Partner reply with gemini-3.8-flash.
//
//   node scripts/follow-up-check.mjs [runs=3] [concurrency=6] [notes=old,new] [clip path filter]
//
// Ticket 11: `TYPES=1 node scripts/follow-up-check.mjs [runs] [concurrency]` plays the same 12 clips with the current
// note, once with each clip's own type from the original five ("five") and once with each of the two added types
// ("added"), and counts how often a reply has the shape of Have you considered…? or Hostile framing.
//
// Reads GEMINI_API_KEY from the repo root's .env (never prints it). Writes the replies and scores to
// test/follow-up/results-<time>.json and prints a summary.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = Number(process.argv[2] ?? 3);
const CONCURRENCY = Number(process.argv[3] ?? 6);
const NOTE_KINDS = (process.argv[4] ?? "old,new").split(",");
const CLIP_FILTER = process.argv[5]; // only clips whose path contains this

// A worktree has no .env of its own: fall back to the main checkout's.
const ENV = [join(APP, "..", ".env"), join(execSync("git rev-parse --git-common-dir", { cwd: APP, encoding: "utf8" }).trim(), "..", ".env")]
  .map((p) => (p.startsWith("/") ? p : join(APP, p)))
  .find(existsSync);
const KEY = readFileSync(ENV, "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("GEMINI_API_KEY not found in .env");

const liveToken = readFileSync(join(APP, "src/worker/live-token.ts"), "utf8");
const PARTNER_PROMPT = liveToken.match(/const PARTNER_PROMPT = `([\s\S]*?)`;/)[1];
const LIVE_MODEL = liveToken.match(/LIVE_MODEL = "(.*?)"/)[1];
const VOICE = liveToken.match(/VOICE = "(.*?)"/)[1];
const JUDGE_MODEL = "gemini-3.8-flash";

// Mirrors src/engine/session.ts.
const LABEL = { why: "Why", soWhat: "So what", counterexample: "Counterexample", changeYourMind: "What would change your mind", beSpecific: "Be specific", haveYouConsidered: "Have you considered…?", hostileFraming: "Hostile framing" };
const ASK = {
  why: "ask for the single strongest reason behind what they just said",
  soWhat: "ask what actually changes as a consequence of their point",
  counterexample: "raise a concrete case that cuts against what they just said and ask how their answer holds up",
  changeYourMind: "ask what evidence or situation would make them change their position",
  beSpecific: "ask for one concrete example, number or detail behind the vaguest part of their answer",
  haveYouConsidered:
    "raise one risk their answer didn't cover, starting \"Have you considered…\"; you want reassurance that it is under control, so don't give your own view of it",
  hostileFraming:
    "restate their point back as a blunt attack in one short question (for example \"So this is just too ambitious?\"); stay polite, with no insults or sneering, and don't agree with the attack",
};
const LAPTOPS = {
  main: "The owner is thinking about banning laptops on weekends, from 9 to 2. Good idea or not? What's your call?",
  lines: {
    why: "What's the single strongest reason?",
    soWhat: "Okay, so if she does that — what actually changes for the business?",
    counterexample: "But the laptop people buy two coffees and a lunch. Doesn't that kill your argument?",
    changeYourMind: "What would you need to see to change your mind?",
    beSpecific: "Give me one concrete example of how that plays out on a Saturday.",
  },
};
const CASH = {
  main: "Different topic. Should cafés stop taking cash completely? Yes or no — and why?",
  lines: {
    why: "Which reason matters most to you?",
    soWhat: "So what's the cost if they're wrong about that?",
    counterexample: "What about an older customer who only carries cash?",
    changeYourMind: "Is there any situation where you'd say the opposite?",
    beSpecific: "Put a number on it — how much time or money are we talking about?",
  },
};

// "old" is the note before ticket 09; "new" mirrors followUpNote() in src/engine/session.ts. Keep it in step by hand,
// or the check measures a note the engine no longer sends. The Rounds below mirror src/content/corner-cafe.ts.
const NOTES = {
  old: (type, line) =>
    `[Director] When the learner finishes this answer, ask one Follow-up of type "${LABEL[type]}": ${ASK[type]}. ` +
    `Build it on their own words. A line that fits this question: "${line}"`,
  new: (type) =>
    `[Director] When the learner finishes this answer, ask one Follow-up of type "${LABEL[type]}": ${ASK[type]}. ` +
    `Build it on one specific thing they just said (a word, a number, an example, or a condition such as "it depends on…"). ` +
    `Never ask a generic question that would fit any answer, and never assume a side they didn't take. ` +
    `If their answer made no call (for example "it depends on…" with both sides left open), shape this same ` +
    `"${LABEL[type]}" question so that answering it forces them to make the call for this case. ` +
    `If they did make a call, don't ask them to choose a side.`,
};

// `asked`: the Partner's question before the Answer (the Main question, or the Follow-up the clip was written for).
const CASES = [
  { clip: "follow-up/hedge-size.wav", scene: LAPTOPS, asked: LAPTOPS.main, type: "soWhat", hedge: true },
  { clip: "follow-up/like-i-said.wav", scene: LAPTOPS, asked: LAPTOPS.lines.counterexample, type: "changeYourMind", hedge: true },
  { clip: "follow-up/one-line.wav", scene: LAPTOPS, asked: LAPTOPS.main, type: "counterexample" },
  { clip: "follow-up/number.wav", scene: LAPTOPS, asked: LAPTOPS.lines.beSpecific, type: "why" },
  { clip: "fake-mic/01-main-pause.wav", scene: LAPTOPS, asked: LAPTOPS.main, type: "soWhat" },
  { clip: "fake-mic/02-done.wav", scene: LAPTOPS, asked: LAPTOPS.lines.why, type: "beSpecific" },
  { clip: "fake-mic/03-barge-in.wav", scene: LAPTOPS, asked: LAPTOPS.lines.counterexample, type: "counterexample" },
  { clip: "fake-mic/04-filler-pause.wav", scene: LAPTOPS, asked: LAPTOPS.lines.changeYourMind, type: "why" },
  { clip: "fake-mic/08-r2-main.wav", scene: CASH, asked: CASH.main, type: "beSpecific" },
  { clip: "fake-mic/09-r2-fu1.wav", scene: CASH, asked: CASH.lines.changeYourMind, type: "soWhat" },
  { clip: "fake-mic/10-r2-fu2.wav", scene: CASH, asked: CASH.lines.beSpecific, type: "counterexample" },
  { clip: "fake-mic/11-r2-fu3.wav", scene: CASH, asked: CASH.lines.counterexample, type: "changeYourMind" },
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One Live session: the Partner says `asked`, gets the note, hears the clip, replies. */
async function runCase(c, noteKind) {
  const ws = new WebSocket(
    `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`,
  );
  ws.binaryType = "arraybuffer";
  let onTurn = null, out = "", heard = "", setupDone;
  const ready = new Promise((r) => (setupDone = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8"));
    if (m.setupComplete) setupDone();
    const sc = m.serverContent;
    if (sc?.outputTranscription?.text) out += sc.outputTranscription.text;
    if (sc?.inputTranscription?.text) heard += sc.inputTranscription.text;
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

  send({ clientContent: { turns: [{ role: "user", parts: [{ text: `[Director] Say exactly this, word for word, and nothing else: "${c.asked}"` }] }], turnComplete: true } });
  await turn();
  const question = out.trim();
  out = "";
  send({ clientContent: { turns: [{ role: "user", parts: [{ text: NOTES[noteKind](c.type, c.scene.lines[c.type]) }] }], turnComplete: false } });
  await sleep(300);

  const pcm = clipPcm16k(c.clip);
  const reply = turn();
  send({ realtimeInput: { activityStart: {} } });
  const CHUNK = 640; // 40 ms
  for (let i = 0; i < pcm.length; i += CHUNK) {
    const part = pcm.subarray(i, i + CHUNK);
    send({ realtimeInput: { audio: { data: Buffer.from(part.buffer, part.byteOffset, part.byteLength).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
    await sleep(40);
  }
  send({ realtimeInput: { activityEnd: {} } });
  await reply;
  ws.onclose = null;
  ws.close();
  return { question, heard: heard.trim(), reply: out.trim() };
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    copiesSceneLine: { type: "boolean", description: "(a) The reply is the scene line (near) verbatim, or another generic question that would fit any answer." },
    picksUpSpecific: { type: "boolean", description: "(b) The reply picks up something specific the learner said: a word, number, example or condition from the answer." },
    fitsType: { type: "boolean", description: "(c) The reply is a question of the requested Follow-up type." },
    assumesSide: { type: "boolean", description: "(d) The reply assumes the learner took a side they did not take (e.g. treats a hedge as backing the ban)." },
    pressesForPosition: { type: "boolean", description: "The reply presses the learner to commit to a position." },
    raisesNewRisk: { type: "boolean", description: "The reply raises a risk or downside that the learner's answer did not cover, in the form of \"Have you considered…\" or close to it." },
    restatesAsAttack: { type: "boolean", description: "The reply restates the learner's own point back as a blunt attack or dismissal, in a short question (for example \"So this is just too ambitious?\")." },
    agreesOrPraises: { type: "boolean", description: "The reply agrees with the learner, praises them or their answer, or softens into reassurance." },
    rude: { type: "boolean", description: "The reply is insulting, sneering, sarcastic or otherwise rude toward the learner, beyond a polite colleague pushing back." },
    why: { type: "string" },
  },
  required: ["copiesSceneLine", "picksUpSpecific", "fitsType", "assumesSide", "pressesForPosition", "raisesNewRisk", "restatesAsAttack", "agreesOrPraises", "rude", "why"],
};

async function judge(c, answer, reply) {
  const prompt = `You score one follow-up question in a spoken English practice call. Be strict.

Partner's previous question: "${c.asked}"
Learner's answer (transcript): "${answer}"
Requested follow-up type: "${LABEL[c.type]}" — ${ASK[c.type]}.
${c.scene.lines[c.type] ? `Scene's example line for this type (the Partner was NOT supposed to just read it): "${c.scene.lines[c.type]}"` : "This type has no example line."}
Partner's follow-up: "${reply}"

Score the follow-up.`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { thinkingConfig: { thinkingLevel: "low" }, responseMimeType: "application/json", responseJsonSchema: JUDGE_SCHEMA },
      }),
    });
    if (r.ok) return JSON.parse((await r.json()).candidates[0].content.parts[0].text);
    await sleep(1500 * (i + 1));
  }
  return null;
}

const words = (t) => new Set(t.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []);
/** Share of the scene line's words that the reply repeats. */
const overlap = (reply, line) => {
  const l = words(line), r = words(reply);
  return l.size ? [...l].filter((w) => r.has(w)).length / l.size : 0;
};

// The answer text the judge sees: the fake-mic / clip scripts (input transcription is unreliable for `say` voices).
const SCRIPTS = Object.fromEntries(
  [join(APP, "test/fake-mic/make-clips.sh"), join(APP, "test/follow-up/make-clips.sh")].flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/^gen (\S+) "(.*)"$/gm)].map(([, file, text]) => [
      (f.includes("fake-mic") ? "fake-mic/" : "follow-up/") + file,
      text.replace(/\[\[slnc \d+\]\]\s*/g, ""),
    ]),
  ),
);

const TYPES_MODE = !!process.env.TYPES;
const ADDED = ["haveYouConsidered", "hostileFraming"];
const jobs = [];
if (TYPES_MODE) {
  for (const c of CASES.filter((c) => !CLIP_FILTER || c.clip.includes(CLIP_FILTER)))
    for (let run = 1; run <= RUNS; run++) {
      jobs.push({ c, noteKind: "new", run, set: "five" });
      for (const type of ADDED) jobs.push({ c: { ...c, type }, noteKind: "new", run, set: "added" });
    }
} else
  for (const noteKind of NOTE_KINDS)
    for (const c of CASES.filter((c) => !CLIP_FILTER || c.clip.includes(CLIP_FILTER)))
      for (let run = 1; run <= RUNS; run++) jobs.push({ c, noteKind, run });

const results = [];
let next = 0, failed = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    let r;
    for (let attempt = 0; attempt < 2 && !r; attempt++) {
      try {
        r = await runCase(job.c, job.noteKind);
      } catch (e) {
        console.error(`${job.noteKind} ${job.c.clip} #${job.run}: ${e.message}${attempt ? "" : " (retrying)"}`);
      }
    }
    if (!r) {
      failed++;
      continue;
    }
    const answer = SCRIPTS[job.c.clip];
    const score = r.reply ? await judge(job.c, answer, r.reply) : null;
    const line = job.c.scene.lines[job.c.type] ?? "";
    const row = {
      note: job.noteKind, ...(TYPES_MODE ? { set: job.set } : {}), noteText: NOTES[job.noteKind](job.c.type, line), clip: job.c.clip, type: job.c.type, hedge: !!job.c.hedge,
      run: job.run, ...r, sceneOverlap: +overlap(r.reply, line).toFixed(2), score,
    };
    results.push(row);
    console.log(`[${row.set ?? row.note}] ${row.clip} (${LABEL[row.type]}) #${row.run}: ${row.reply || "(no words)"}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const file = join(APP, "test/follow-up", `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));

if (TYPES_MODE) {
  console.log("\nset | type | replies | raises new risk | restates as attack | fits type | picks up specific | agrees or praises | rude | assumes side");
  for (const [set, types] of [["five", Object.keys(LABEL).filter((t) => !ADDED.includes(t))], ["added", ADDED]])
    for (const type of types) {
      const rs = results.filter((r) => r.set === set && r.type === type);
      if (!rs.length) continue;
      const n = (f) => rs.filter((r) => r.score && f(r.score)).length;
      console.log(
        `${set} | ${LABEL[type]} | ${rs.length} | ${n((x) => x.raisesNewRisk)} | ${n((x) => x.restatesAsAttack)} | ${n((x) => x.fitsType)} | ` +
          `${n((x) => x.picksUpSpecific)} | ${n((x) => x.agreesOrPraises)} | ${n((x) => x.rude)} | ${n((x) => x.assumesSide)}`,
      );
    }
  console.log(`\n${failed ? `${failed} case(s) failed twice and are left out. ` : ""}${file}`);
  process.exit(0);
}
console.log("\nnote | replies | copies Scene line (≥0.7 word overlap) | (a) generic or copied | (b) picks up specific | (c) fits type | (d) assumes side | hedges pressed");
for (const note of Object.keys(NOTES)) {
  const rs = results.filter((r) => r.note === note);
  if (!rs.length) continue;
  const n = (f) => rs.filter(f).length;
  const hedges = rs.filter((r) => r.hedge);
  console.log(
    `${note} | ${rs.length} | ${n((r) => r.sceneOverlap >= 0.7)} | ${n((r) => r.score?.copiesSceneLine)} | ${n((r) => r.score?.picksUpSpecific)} | ` +
      `${n((r) => r.score?.fitsType)} | ${n((r) => r.score?.assumesSide)} | ${hedges.filter((r) => r.score?.pressesForPosition).length}/${hedges.length}`,
  );
}
console.log(`\n${failed ? `${failed} case(s) failed twice and are left out. ` : ""}${file}`);
