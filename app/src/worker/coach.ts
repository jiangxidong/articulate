// The Coach brain (ADR-0001): gemini-3.8-flash picks the Round's Coaching point from the verbatim transcript, later
// rewrites the Redo into the Better version, comments on the Transfer Answer, and sets the Next focus. The Partner only
// speaks what this returns.
import type { CoachingPoint, Exchange, NextFocusInput } from "../engine/types";
import { betterVersionProblems, givesAWording, hasSingleQuotedPhrase } from "./coach-checks";
import type { Env } from "./env";
import { postGemini, upstreamError } from "./gemini-api";

const MODEL = "gemini-3.8-flash";
// "low" answers in ~2-3 s; "medium" took ~7.5 s for the same Coaching point.
const THINKING = { thinkingLevel: "low" };

const LEARNER = "The learner is a product manager and a non-native English speaker, practising spoken answers for meetings in a live call with a Partner who asks a Main question and then presses with Follow-ups. The transcript is verbatim: fillers, repetitions and false starts are kept.";

// The learner's course on high-stakes PM communication (lessons 0001, 0003, 0004): every answer is judged and rewritten
// against this one skeleton, the same one the Thinking patterns teach (content/practice.ts).
const SKELETON = `The learner's course teaches one answer skeleton, and they are judged against it:
- Paraphrase (optional): one sentence restating the question. Fine before the Answer, never instead of it. Praising the question ("That's a great question") is not a Paraphrase.
- Answer: the first sentence of substance states their call plainly. When they are unsure, an honest first read said with confidence ("My first read is…", "more likely X than Y") is an Answer. Hedging ("I'm not sure, but maybe…", "it depends" with no call) is not.
- Detail: one concrete example or number that backs the Answer. With no number, a relative term ("a small share", "more likely") is fine. One Detail is enough. Giving several reasons is not a problem in itself, but the course never asks for them or for "first… second…".
- So what: what the answer means for the person asking. Then a clean stop: no trailing "so yeah…", no restart, no new point after it.
- On a question under uncertainty, the Detail reasons with at least one lens (Likelihood × Impact; a one-way or two-way door, can it be undone?; an early signal), and the last step, before the stop, names a tripwire: the signal that would change their call and what they would do then.
Their three Thinking patterns are shapes of this skeleton: Answer first (Answer → Detail → So what → Stop), First read (First read → It turns on X → If X flips → My call), Two options + pick (A or B → My pick → Because → So for you; "A or B" works as the Paraphrase).`;

const POINT_PROMPT = `You are the Coach brain of a spoken-English practice app. ${LEARNER}

${SKELETON}

Choose exactly ONE Coaching point for the Round: the single change that would most improve the learner's next attempt at the Main question. Judge mostly what they said to the Main question; their replies to the Follow-ups show what they could have said in it.

Rubric, in priority order. Choose the first dimension that has a real problem:
1. directness: the Answer is not their first sentence of substance (after an optional one-sentence Paraphrase), or it is hedged so much that it is unclear what they think, or they open by praising the question.
2. structure: the Answer is there, but a step is missing or out of place: no Detail, no so what, the Detail before the Answer, wandering back and forth between steps, or no clean stop. Several reasons are a problem only when they bury the Answer or crowd out the so what.
3. reasoning: the steps are there, but the Detail is vague (no concrete example or number) or doesn't back the Answer; or, on a question under uncertainty, no lens is used or the tripwire has no signal or no action.
Never choose delivery (fillers, pauses, pace, length, grammar, pronunciation). If everything is solid, still choose the weakest dimension.

quote: the learner's own words that show the problem, copied exactly from one of their Answers: the same words in the same order, fillers included, 3 to 15 words. Never paraphrase, shorten inside, or fix grammar.
fix: the ONE change to make in the Redo, as a colleague would say it to them: one step, not a list of changes. Name the skeleton step by its name (Paraphrase, Answer, Detail, So what, Stop, First read, tripwire) and say where it went wrong, for example "Your Answer came in your third sentence. Put it first." One or two short spoken sentences, second person, under 30 words, plain English, concrete enough to act on right now. Say what to change, not what to say: never give them a sentence or opening to use, never quote a better wording, and never add a position, reason or example they didn't give. Never ask for more reasons, or for "first… second…". The learner must find their own words in the Redo; the Better version comes only after it. No praise, no scores, and don't repeat the quote.`;

const BETTER_PROMPT = `You write the Better version in a spoken-English practice app. ${LEARNER}

${SKELETON}

After a Coaching point, the learner answered the Main question again (the Redo). Rewrite the Redo into a Better version: what they could have said, in the skeleton.
- Keep their position exactly: the same answer, the same side, the same conditions. Never change, soften or strengthen their stance.
- Use only their facts: their own reasons, examples and numbers, from the Redo or their earlier Answers in this Round. Never add a fact, number, reason or example they didn't give. Keep their own words where possible.
- Answer: the first sentence states their call. No Paraphrase and no comment on the question before it.
- Detail: their single most concrete reason or example, with their number if they gave one. Leave their other reasons out. On a first read, the Detail is what it turns on, as they said it.
- So what: end on what it means for the person asking, drawn from what they said. On a first read, end instead on their tripwire if they gave one: what would flip it and what they would do then. Stop there.
- Each sentence about 12 words at most, with at most two thought groups. 3 or 4 sentences in all.
- Apply the Coaching point. Drop fillers, false starts and repetition. Natural spoken English that a confident non-native speaker could say in a meeting.
- First person. Output only the answer itself: no preamble, no labels, no quotation marks.
If the Redo is empty or off-topic, rewrite their first Answer instead.`;

const TRANSFER_PROMPT = `You are the Coach brain of a spoken-English practice app. ${LEARNER}

${SKELETON}

The Session had two Rounds, each with one Coaching point. Then the learner answered a new Transfer question, with no help. Write ONE spoken sentence of comment on the Transfer Answer: did the Coaching points carry over?
- If a Coaching point carried over, say so plainly and specifically (what they did this time). If it didn't, say what to change next time, tied to that Coaching point. If one carried over and one didn't, name the one that didn't.
- Judge only directness, structure and reasoning against the skeleton, never delivery (fillers, pauses, pace, grammar, pronunciation). Name the skeleton step by its name (Answer, Detail, So what, Stop, First read, tripwire).
- Say what to change, not what to say: never give them a sentence or opening to use, never suggest a wording, and never add a position, reason or example they didn't give. Never ask for more reasons, or for "first… second…".
- You may quote the learner, in double quotes, only with their exact words from the Transfer Answer (3 to 12 words, fillers included). Use no other quotation marks.
- One sentence, second person, under 30 words, plain English, as a colleague would say it. No praise words like "great" or "well done", no scores. Don't mention "Coaching point" or "Round".`;

const NEXT_FOCUS_PROMPT = `You are the Coach brain of a spoken-English practice app. ${LEARNER}

${SKELETON}

The Session is over. It had up to two Rounds, each with one Coaching point and a Redo, then a Transfer question answered with no help. Write the Next focus: ONE line that the learner will see and hear when the next Session opens, the single habit to work on next time.
- Base it on this Session's Coaching points and on whether the Redos and the Transfer Answer applied them. A point that didn't carry over is usually the Next focus. If every point carried over, choose the next real problem in the Redos or the Transfer Answer, in rubric order: directness (the Answer first), structure (Answer → Detail → So what, then stop), reasoning (a concrete Detail; on a question under uncertainty, a lens and a tripwire).
- Name the skeleton step they missed by its name (Answer, Detail, So what, Stop, First read, tripwire).
- Judge only directness, structure and reasoning, never delivery (fillers, pauses, pace, length, grammar, pronunciation). Never ask for more reasons, or for "first… second…".
- Say what to do, not what to say: never give a sentence, opening or wording to use, and use no quotation marks. Never mention this Session's topics, positions, reasons or examples: the line must apply to any question.
- One sentence, an instruction in the second person, at most 12 words, plain English, as a colleague would say it. The Partner says it in one breath when the next Session opens. No praise, no scores. Don't mention "Coaching point", "Round", "Redo", "Transfer" or "Session".`;

const ANSWER_FIRST_PROMPT = `You judge one habit in a spoken-English practice app. ${LEARNER}

${SKELETON}

For each of the learner's Answers below, judge only this: is the Answer step their first sentence of substance?
- Yes: the first sentence of substance states their call plainly, in reply to the question they were asked. A one-sentence Paraphrase before it is fine ("So the question is whether…", "A or B?"), and so is an honest first read said with confidence ("My first read is…", "more likely X than Y"). A short opener that leads straight into the call is part of the Answer sentence, even where the transcript puts a full stop after it: "Not fully assessed yet — my first read is…", "Short answer:", "My bottom line is…". Ignore fillers and false starts.
- On a Follow-up, the call is their direct reply to that Follow-up: for "Why", the reason; for "What would change your mind", the condition; for a challenge, whether they hold their position.
- No: the call comes later, or never; the first sentence is background, a story, or a list of factors; it is hedged so much that it is unclear what they think ("I'm not sure, but maybe…", "it depends" with no call); or they open by praising the question ("That's a great question").
Judge every Answer on its own, by this rule only. Never judge delivery, grammar, length or the quality of the reasons.`;

const ANSWER_FIRST_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "integer" }, answerFirst: { type: "boolean" } },
        required: ["n", "answerFirst"],
      },
    },
  },
  required: ["verdicts"],
};

const POINT_SCHEMA = {
  type: "object",
  properties: {
    dimension: { type: "string", enum: ["directness", "structure", "reasoning"] },
    quote: { type: "string" },
    fix: { type: "string" },
  },
  required: ["dimension", "quote", "fix"],
};

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

function roundText(mainQuestion: string, exchanges: Exchange[]) {
  const lines = [`Main question: ${mainQuestion}`];
  for (const x of exchanges) {
    lines.push(x.followUpType ? `Partner (Follow-up, ${x.followUpType}): ${x.question}` : `Partner (Main question): ${x.question || mainQuestion}`);
    lines.push(`Learner: ${x.answer || "(nothing transcribed)"}`);
  }
  return lines.join("\n");
}

/** schema: answer in JSON of that shape; otherwise plain text. */
async function generate(env: Env, system: string, user: string, schema?: object): Promise<Response | string> {
  const r = await postGemini(`/v1beta/models/${MODEL}:generateContent`, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { thinkingConfig: THINKING, ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}) },
  }, env);
  if (!r.ok) return upstreamError("coach", r);
  const d = await r.json<GenerateResponse>();
  return (d.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim();

// POST /api/coach/point { mainQuestion, exchanges } → CoachingPoint
export async function coachingPoint(request: Request, env: Env): Promise<Response> {
  const { mainQuestion, exchanges } = await request.json<{ mainQuestion: string; exchanges: Exchange[] }>();
  const answers = normalize(exchanges.map((x) => x.answer).join(" | "));
  let user = roundText(mainQuestion, exchanges);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await generate(env, POINT_PROMPT, user, POINT_SCHEMA);
    if (out instanceof Response) return out;
    let point: CoachingPoint;
    try {
      point = JSON.parse(out) as CoachingPoint;
    } catch {
      continue;
    }
    // The quote must be the learner's own words: the Partner reads it out as "You said: …". The fix must not hand them
    // a wording to say (that would be the Better version, read aloud before the Redo).
    const scriptsAnAnswer = givesAWording(point.fix ?? "");
    if (point.quote && answers.includes(normalize(point.quote)) && !scriptsAnAnswer) {
      return Response.json({ dimension: point.dimension, quote: point.quote.trim(), fix: point.fix.trim() } satisfies CoachingPoint);
    }
    console.log(`coaching point attempt ${attempt} rejected: ${JSON.stringify(point)}`);
    user += scriptsAnAnswer
      ? `\n\nYour fix gives the learner words to say. Say what to change instead, without any wording for them to use.`
      : `\n\nYour quote "${point.quote}" is not an exact copy of the learner's words. Copy the quote exactly from one Answer above.`;
  }
  return Response.json({ error: "no verbatim quote" }, { status: 502 });
}

// POST /api/coach/transfer { question, answer, coachingPoints } → { text }
export async function transferComment(request: Request, env: Env): Promise<Response> {
  const { question, answer, coachingPoints } =
    await request.json<{ question: string; answer: string; coachingPoints: CoachingPoint[] }>();
  const points = coachingPoints.length
    ? coachingPoints.map((p, i) => `${i + 1}. (${p.dimension}) They said "${p.quote}". ${p.fix}`).join("\n")
    : "(none: no Coaching point was given in this Session; comment on directness, structure or reasoning instead)";
  let user = `Coaching points given in this Session:\n${points}\n\nTransfer question: ${question}\nLearner's Transfer Answer: ${answer || "(nothing transcribed)"}`;
  const said = normalize(answer);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await generate(env, TRANSFER_PROMPT, user);
    if (out instanceof Response) return out;
    const text = out.replace(/\s+/g, " ").trim();
    // Anything in quotes must be the learner's own words; anything else in quotes would hand them a wording.
    const quotes = [...text.matchAll(/["“”]([^"“”]+)["“”]/g)].map((m) => m[1]);
    const strayQuote = hasSingleQuotedPhrase(text) || (text.match(/["“”]/g) ?? []).length % 2 === 1;
    const bad = quotes.find((q) => !said.includes(normalize(q)));
    if (text && !bad && !strayQuote && text.split(/\s+/).length <= 45) return Response.json({ text });
    console.log(`transfer comment attempt ${attempt} rejected: ${text}`);
    user += bad || strayQuote
      ? `\n\nYour comment quotes words the learner didn't say in the Transfer Answer${bad ? ` ("${bad}")` : ""}. Quote only their exact words, or don't quote.`
      : `\n\nWrite one sentence, under 30 words.`;
  }
  return Response.json({ error: "no usable Transfer comment" }, { status: 502 });
}

// POST /api/coach/better { mainQuestion, exchanges, coachingPoint, redo } → { text }
export async function betterVersion(request: Request, env: Env): Promise<Response> {
  const { mainQuestion, exchanges, coachingPoint: point, redo } =
    await request.json<{ mainQuestion: string; exchanges: Exchange[]; coachingPoint: CoachingPoint; redo: string }>();
  const round = roundText(mainQuestion, exchanges);
  let user = `${round}

Coaching point (${point.dimension}): the learner said "${point.quote}". ${point.fix}

Redo (the learner's second attempt at the Main question): ${redo || "(nothing transcribed)"}`;
  // Checked against everything said in the Round: a number the learner never gave would be a fact made up for them.
  const said = `${round}\n${redo}`;
  let fallback: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await generate(env, BETTER_PROMPT, user);
    if (out instanceof Response) return out;
    const text = out.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const problems = betterVersionProblems(text, said);
    if (!problems.length) return Response.json({ text });
    // Long sentences or a slow start are a style miss: better shown than no Better version at all.
    if (!problems.some((p) => p.hard)) fallback = text;
    console.log(`better version attempt ${attempt} rejected: ${text} (${problems.map((p) => p.fix).join(" ")})`);
    user += `\n\nYour Better version broke the rules:\n${problems.map((p) => `- ${p.fix}`).join("\n")}\nWrite it again.`;
  }
  if (fallback) return Response.json({ text: fallback });
  return Response.json({ error: "no usable Better version" }, { status: 502 });
}

// POST /api/coach/next-focus NextFocusInput → { text }
export async function nextFocus(request: Request, env: Env): Promise<Response> {
  const { rounds, transfer } = await request.json<NextFocusInput>();
  const parts = rounds.map((r, i) => [
    `Round ${i + 1}. Main question: ${r.mainQuestion}`,
    r.coachingPoint ? `Coaching point (${r.coachingPoint.dimension}): they said "${r.coachingPoint.quote}". ${r.coachingPoint.fix}` : "No Coaching point.",
    r.coachingPoint ? `Redo: ${r.redo || "(none)"}` : "",
  ].filter(Boolean).join("\n"));
  if (transfer) parts.push(`Transfer question: ${transfer.question}\nTransfer Answer: ${transfer.answer}`);
  else parts.push("The Session ended before the Transfer question was answered.");
  let user = parts.join("\n\n");
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await generate(env, NEXT_FOCUS_PROMPT, user);
    if (out instanceof Response) return out;
    const text = out.replace(/\s+/g, " ").trim();
    // The Partner reads it out and the learner sees it before the next Session: it must not hand them a wording.
    const scripted = givesAWording(text);
    // The prompt asks for at most 12 words; a couple more are still one breath.
    const words = text.split(" ").length;
    if (text && !scripted && words <= 14) return Response.json({ text: /[.!?]$/.test(text) ? text : `${text}.` });
    console.log(`next focus attempt ${attempt} rejected: ${text}`);
    user += scripted ? "\n\nYour line gives the learner words to say. Say what to do instead, with no quotation marks." : "\n\nWrite one sentence, at most 12 words.";
  }
  return Response.json({ error: "no usable Next focus" }, { status: 502 });
}

// POST /api/coach/answer-first { answers: { question, answer }[] } → { answerFirst: boolean[] }, one per Answer, in order.
// A speech metric on the summary (ticket 08), asked for after the Session.
export async function answerFirst(request: Request, env: Env): Promise<Response> {
  const { answers } = await request.json<{ answers: { question: string; answer: string }[] }>();
  const user = answers.map((a, i) => `Answer ${i + 1}\nQuestion: ${a.question || "(the Main question)"}\nLearner: ${a.answer}`).join("\n\n");
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await generate(env, ANSWER_FIRST_PROMPT, user, ANSWER_FIRST_SCHEMA);
    if (out instanceof Response) return out;
    try {
      const { verdicts } = JSON.parse(out) as { verdicts: { n: number; answerFirst: boolean }[] };
      const byN = new Map(verdicts.map((v) => [v.n, v.answerFirst]));
      const result = answers.map((_, i) => byN.get(i + 1));
      if (result.every((v) => typeof v === "boolean")) return Response.json({ answerFirst: result });
    } catch { /* asked again */ }
    console.log(`answer first attempt ${attempt} rejected: ${out}`);
  }
  return Response.json({ error: "no verdict for every Answer" }, { status: 502 });
}
