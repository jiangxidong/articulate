// Ticket 10: does the Coach brain judge and rewrite against the course's skeleton? Runs the Worker's own coach.ts, old
// (from a git ref) against new (the working tree), on the Rounds in test/coach/transcripts.json (fake-mic and synthetic
// calls): Coaching point → Better version for each Round, then the Transfer comment and the Next focus for each call.
// Each output is counted with the Worker's checks (coach-checks.ts) and scored blind by gemini-3.8-flash.
//
//   node scripts/coach-check.mjs [runs=3] [old ref=main] [concurrency=6]
//
// Reads GEMINI_API_KEY from the repo root's .env (never prints it). Writes every output and score to
// test/coach/results-<time>.json and prints the counts.
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = Number(process.argv[2] ?? 3);
const OLD_REF = process.argv[3] ?? "main";
const CONCURRENCY = Number(process.argv[4] ?? 6);
const JUDGE_MODEL = "gemini-3.8-flash";

// A worktree has no .env of its own: fall back to the main checkout's.
const ENV = [join(APP, "..", ".env"), join(execSync("git rev-parse --git-common-dir", { cwd: APP, encoding: "utf8" }).trim(), "..", ".env")]
  .map((p) => (p.startsWith("/") ? p : join(APP, p)))
  .find(existsSync);
const KEY = readFileSync(ENV, "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
if (!KEY) throw new Error("GEMINI_API_KEY not found in .env");
const env = { GEMINI_API_KEY: KEY };

/** Bundles src/worker/<file> from `root` into an importable module. */
async function load(root, file, name) {
  const out = join(mkdtempSync(join(tmpdir(), `coach-${name}-`)), `${file}.mjs`);
  await build({ entryPoints: [join(root, "src/worker", `${file}.ts`)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
  return import(pathToFileURL(out).href);
}
const oldRoot = mkdtempSync(join(tmpdir(), "coach-old-src-"));
execSync(`git archive ${OLD_REF} src/worker src/engine | tar -x -C "${oldRoot}"`, { cwd: APP });
const VARIANTS = { old: await load(oldRoot, "coach", "old"), new: await load(APP, "coach", "new") };
const { betterVersionProblems, givesAWording, numbersIn, sentencesOf, wordCount } = await load(APP, "coach-checks", "checks");
const SKELETON = readFileSync(join(APP, "src/worker/coach.ts"), "utf8").match(/const SKELETON = `([\s\S]*?)`;/)[1];
const { calls } = JSON.parse(readFileSync(join(APP, "test/coach/transcripts.json"), "utf8"));

// The Worker logs each rejected attempt; keep them out of the summary.
const log = console.log;
console.log = (...a) => (/attempt \d rejected/.test(String(a[0])) ? undefined : log(...a));

async function call(variant, fn, body) {
  for (let i = 0; ; i++) {
    try {
      const r = await VARIANTS[variant][fn](new Request("http://coach", { method: "POST", body: JSON.stringify(body) }), env);
      const json = await r.json();
      return r.ok ? json : { failed: json.error };
    } catch (e) {
      // A dropped connection on our side, not the Coach brain's answer: try again.
      if (i === 2) return { failed: `network: ${e.message}` };
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

async function judge(prompt, schema) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { thinkingConfig: { thinkingLevel: "medium" }, responseMimeType: "application/json", responseJsonSchema: schema },
      }),
    }).catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      return JSON.parse(d.candidates[0].content.parts.filter((p) => !p.thought).map((p) => p.text).join(""));
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return null;
}
const bool = (description) => ({ type: "boolean", description });
const schema = (props) => ({ type: "object", properties: props, required: Object.keys(props) });

const roundText = (r) => [`Main question: ${r.mainQuestion}`, ...r.exchanges.flatMap((x) => [`Partner: ${x.question}`, `Learner: ${x.answer}`])].join("\n");

const POINT_JUDGE = schema({
  namesStep: bool("The fix names a step of the skeleton (Paraphrase, Answer, Detail, So what, Stop, First read, tripwire) and where it went wrong."),
  asksForReasons: bool("The fix asks for more reasons, numbered reasons, or 'first… second…' signposting."),
  faultsParaphrase: bool("The point treats a one-sentence restating of the question, said before the Answer, as the problem."),
  givesWording: bool("The fix hands the learner a sentence, opening or wording to say."),
  courseAligned: bool("Overall, the point judges the Round the way the skeleton above does."),
});
const BETTER_JUDGE = schema({
  answerFirst: bool("The first sentence states the learner's call."),
  oneDetail: bool("It gives one Detail (one reason or example), not a list of reasons."),
  endsOnSoWhat: bool("The last sentence says what it means for the person asking, and nothing follows it."),
  keepsPosition: bool("It keeps the learner's position: same side, same conditions."),
  addsFacts: bool("It adds a fact, number, reason or example the learner never gave in the Round or the Redo."),
});

const FOCUS_JUDGE = schema({
  namesStep: bool("The line names a step of the skeleton (Paraphrase, Answer, Detail, So what, Stop, First read, tripwire)."),
  asksForReasons: bool("The line asks for more reasons, numbered reasons, or 'first… second…' signposting."),
  courseAligned: bool("Overall, the line asks for a habit the skeleton above teaches."),
});
const focusPrompt = (t) => `${SKELETON}

Here is the one-line focus a coach gave a learner for their next practice Session. Score it.

${t}`;

const pointPrompt = (r, p) => `${SKELETON}

Here is a practice Round and the Coaching point a coach gave on it. Score the Coaching point.

${roundText(r)}

Coaching point (${p.dimension}): quote "${p.quote}". Fix: ${p.fix}`;
const betterPrompt = (r, b) => `${SKELETON}

Here is a practice Round, the learner's second attempt (Redo), and a rewrite of it (the Better version). Score the rewrite.

${roundText(r)}
Redo: ${r.redo}

Better version: ${b}`;

// Case-insensitive, so the old prompt's "answer" counts too; the judge's count is the fairer one.
const STEP = /\b(paraphrase|answer|detail|so what|stop|first read|tripwire)\b/i;
const REASONS = /\b(two|three|several|more|main|key) (main |key )?reasons\b|\bfirst\b[^.]*\bsecond\b|signpost/i;

async function runCall(c, variant, run) {
  const rounds = [];
  for (const r of c.rounds) {
    const point = await call(variant, "coachingPoint", { mainQuestion: r.mainQuestion, exchanges: r.exchanges });
    const out = { round: r.mainQuestion.slice(0, 40), point };
    if (!point.failed) {
      out.pointScore = await judge(pointPrompt(r, point), POINT_JUDGE);
      const better = await call(variant, "betterVersion", { mainQuestion: r.mainQuestion, exchanges: r.exchanges, coachingPoint: point, redo: r.redo });
      out.better = better.text ?? better;
      if (better.text) {
        const ss = sentencesOf(better.text);
        const said = numbersIn(`${roundText(r)}\n${r.redo}`);
        out.betterStats = {
          words: wordCount(better.text), sentences: ss.length, maxSentenceWords: Math.max(...ss.map(wordCount)),
          sentencesOver12: ss.filter((s) => wordCount(s) > 12).length,
          inventedNumbers: [...numbersIn(better.text)].filter((n) => !said.has(n)),
          checkProblems: betterVersionProblems(better.text, `${roundText(r)}\n${r.redo}`).map((p) => p.fix),
        };
        out.betterScore = await judge(betterPrompt(r, better.text), BETTER_JUDGE);
      }
    }
    rounds.push(out);
  }
  const points = rounds.map((x) => x.point).filter((p) => !p.failed);
  const result = { call: c.id, device: c.device, variant, run, rounds };
  if (c.transfer) {
    const t = await call(variant, "transferComment", { question: c.transfer.question, answer: c.transfer.answer, coachingPoints: points });
    result.transfer = t.text ?? t;
  }
  const nf = await call(variant, "nextFocus", {
    rounds: c.rounds.map((r, i) => ({ mainQuestion: r.mainQuestion, coachingPoint: rounds[i].point.failed ? undefined : rounds[i].point, redo: r.redo })),
    transfer: c.transfer,
  });
  result.nextFocus = nf.text ?? nf;
  if (nf.text) result.nextFocusScore = await judge(focusPrompt(nf.text), FOCUS_JUDGE);
  return result;
}

const jobs = [];
for (let run = 1; run <= RUNS; run++) for (const c of calls) for (const variant of ["old", "new"]) jobs.push(() => runCall(c, variant, run));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++];
    results.push(await j());
    process.stderr.write(".");
  }
}));
process.stderr.write("\n");

const file = join(APP, "test/coach", `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ oldRef: OLD_REF, runs: RUNS, results }, null, 2));

const summary = {};
for (const variant of ["old", "new"]) {
  const rs = results.filter((r) => r.variant === variant);
  const rounds = rs.flatMap((r) => r.rounds);
  const pts = rounds.filter((x) => !x.point.failed);
  const bvs = rounds.filter((x) => x.betterStats);
  const nfs = rs.map((r) => r.nextFocus).filter((t) => typeof t === "string");
  const tcs = rs.map((r) => r.transfer).filter((t) => typeof t === "string");
  const n = (xs, f) => `${xs.filter(f).length}/${xs.length}`;
  const dims = {};
  for (const x of pts) dims[x.point.dimension] = (dims[x.point.dimension] ?? 0) + 1;
  summary[variant] = {
    "Coaching point: returned": `${pts.length}/${rounds.length}`,
    "Coaching point: dimensions": JSON.stringify(dims),
    "Coaching point: names a skeleton step (judge)": n(pts, (x) => x.pointScore?.namesStep),
    "Coaching point: names a skeleton step (regex)": n(pts, (x) => STEP.test(x.point.fix)),
    "Coaching point: asks for reasons / first-second (judge)": n(pts, (x) => x.pointScore?.asksForReasons),
    "Coaching point: asks for reasons / first-second (regex)": n(pts, (x) => REASONS.test(x.point.fix)),
    "Coaching point: faults a Paraphrase (judge)": n(pts, (x) => x.pointScore?.faultsParaphrase),
    "Coaching point: gives a wording (judge)": n(pts, (x) => x.pointScore?.givesWording),
    "Coaching point: course-aligned (judge)": n(pts, (x) => x.pointScore?.courseAligned),
    "Better version: returned": `${bvs.length}/${pts.length}`,
    "Better version: words (median)": median(bvs.map((x) => x.betterStats.words)),
    "Better version: longest sentence (median / max)": `${median(bvs.map((x) => x.betterStats.maxSentenceWords))} / ${max(bvs.map((x) => x.betterStats.maxSentenceWords))}`,
    "Better version: all sentences ≤ 12 words": n(bvs, (x) => x.betterStats.sentencesOver12 === 0),
    "Better version: passes the Worker's checks": n(bvs, (x) => x.betterStats.checkProblems.length === 0),
    "Better version: invents a number": n(bvs, (x) => x.betterStats.inventedNumbers.length > 0),
    "Better version: Answer first (judge)": n(bvs, (x) => x.betterScore?.answerFirst),
    "Better version: one Detail (judge)": n(bvs, (x) => x.betterScore?.oneDetail),
    "Better version: ends on the so what (judge)": n(bvs, (x) => x.betterScore?.endsOnSoWhat),
    "Better version: keeps the position (judge)": n(bvs, (x) => x.betterScore?.keepsPosition),
    "Better version: adds a fact (judge)": n(bvs, (x) => x.betterScore?.addsFacts),
    "Next focus: returned": `${nfs.length}/${rs.length}`,
    "Next focus: words (median / max)": `${median(nfs.map(wordCount))} / ${max(nfs.map(wordCount))}`,
    "Next focus: names a skeleton step (judge)": n(rs.filter((r) => r.nextFocusScore), (r) => r.nextFocusScore.namesStep),
    "Next focus: names a skeleton step (regex)": n(nfs, (t) => STEP.test(t)),
    "Next focus: asks for reasons / first-second (judge)": n(rs.filter((r) => r.nextFocusScore), (r) => r.nextFocusScore.asksForReasons),
    "Next focus: course-aligned (judge)": n(rs.filter((r) => r.nextFocusScore), (r) => r.nextFocusScore.courseAligned),
    "Next focus: asks for reasons / first-second (regex)": n(nfs, (t) => REASONS.test(t)),
    "Next focus: gives a wording": n(nfs, givesAWording),
    "Transfer comment: returned": `${tcs.length}/${rs.filter((r) => r.transfer !== undefined).length}`,
    "Transfer comment: names a skeleton step (regex)": n(tcs, (t) => STEP.test(t)),
    "Transfer comment: asks for reasons / first-second (regex)": n(tcs, (t) => REASONS.test(t)),
  };
}
function max(xs) {
  return xs.length ? Math.max(...xs) : "-";
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : "-";
}
log(`\n${"".padEnd(56)}${"old".padEnd(28)}new`);
for (const k of Object.keys(summary.new)) log(`${k.padEnd(56)}${String(summary.old[k]).padEnd(28)}${summary.new[k]}`);
log(`Written to ${file}`);
