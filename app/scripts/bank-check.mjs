// Ticket 06: does the Partner say every Question bank entry word for word, with the lead-ins the engine adds
// ("First question.", "Second question.", "Last one, quickly.")? Opens gemini-3.8-live directly with the Worker's Live
// config, as follow-up-check.mjs does. One Live session per Scene's three questions at a time.
//
//   node scripts/bank-check.mjs [concurrency=6] [sceneId filter]
//
// Reads GEMINI_API_KEY from the repo root's .env (never prints it). Writes the replies to
// test/bank/results-<time>.json and prints the ones that weren't word for word.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONCURRENCY = Number(process.argv[2] ?? 6);
const FILTER = process.argv[3];

const ENV = [join(APP, "..", ".env"), join(execSync("git rev-parse --git-common-dir", { cwd: APP, encoding: "utf8" }).trim(), "..", ".env")]
  .map((p) => (p.startsWith("/") ? p : join(APP, p)))
  .find(existsSync);
const KEY = readFileSync(ENV, "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("GEMINI_API_KEY not found in .env");

const liveToken = readFileSync(join(APP, "src/worker/live-token.ts"), "utf8");
const PARTNER_PROMPT = liveToken.match(/const PARTNER_PROMPT = `([\s\S]*?)`;/)[1];
const LIVE_MODEL = liveToken.match(/LIVE_MODEL = "(.*?)"/)[1];
const VOICE = liveToken.match(/VOICE = "(.*?)"/)[1];

// Mirror sayExactly() and the lead-ins in src/engine/session.ts.
const sayExactly = (text) => `[Director] Say exactly this, word for word, and nothing else: "${text}"`;
const LEADS = ["First question. ", "Second question. ", "Last one, quickly. "];

const bank = JSON.parse(readFileSync(join(APP, "src/content/question-bank.json"), "utf8"));
// Each Scene's questions in groups of three, as a Session would ask them.
const groups = bank.scenes
  .filter((s) => !FILTER || s.id.includes(FILTER))
  .flatMap((s) => {
    const qs = bank.questions.filter((q) => q.sceneId === s.id);
    return Array.from({ length: Math.ceil(qs.length / 3) }, (_, i) => qs.slice(i * 3, i * 3 + 3));
  });

async function runGroup(questions) {
  const ws = new WebSocket(
    `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${KEY}`,
  );
  ws.binaryType = "arraybuffer";
  let onTurn = null, out = "", setupDone;
  const ready = new Promise((r) => (setupDone = r));
  ws.onmessage = (e) => {
    const m = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8"));
    if (m.setupComplete) setupDone();
    const sc = m.serverContent;
    if (sc?.outputTranscription?.text) out += sc.outputTranscription.text;
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
      outputAudioTranscription: {},
    },
  });
  await Promise.race([ready, closed]);
  const rows = [];
  for (const [i, q] of questions.entries()) {
    const line = `${LEADS[i]}${q.text}`;
    out = "";
    let timer;
    const timeout = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("no turnComplete")), 30_000)));
    const done = Promise.race([closed, new Promise((r) => (onTurn = r)), timeout]).finally(() => clearTimeout(timer));
    send({ clientContent: { turns: [{ role: "user", parts: [{ text: sayExactly(line) }] }], turnComplete: true } });
    await done;
    rows.push({ id: q.id, line, said: out.trim(), verbatim: verbatim(out, line) });
  }
  ws.onclose = null;
  ws.close();
  return rows;
}

// Numbers may come back as words ("9 to 2" → "nine to two"); the transcription, not the Partner, decides that.
const NUMBERS = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 20: "twenty", 50: "fifty", 80: "eighty" };
const norm = (t) =>
  (t.toLowerCase().replace(/’/g, "'").replace(/\b\d+\b/g, (n) => NUMBERS[n] ?? n).replace(/80th/g, "eightieth").match(/[a-z0-9']+/g) ?? []).join(" ");
const verbatim = (said, line) => norm(said) === norm(line);

const results = [];
let next = 0, failed = 0;
async function worker() {
  while (next < groups.length) {
    const g = groups[next++];
    let rows;
    for (let attempt = 0; attempt < 2 && !rows; attempt++) {
      try {
        rows = await runGroup(g);
      } catch (e) {
        console.error(`${g[0].id}: ${e.message}${attempt ? "" : " (retrying)"}`);
      }
    }
    if (!rows) {
      failed += g.length;
      continue;
    }
    results.push(...rows);
    for (const r of rows) if (!r.verbatim) console.log(`DIFFERS ${r.id}\n  line: ${r.line}\n  said: ${r.said}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

mkdirSync(join(APP, "test/bank"), { recursive: true });
const file = join(APP, "test/bank", `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.verbatim).length;
console.log(`\n${ok} / ${results.length} word for word${failed ? `, ${failed} not run (failed twice)` : ""}\n${file}`);
