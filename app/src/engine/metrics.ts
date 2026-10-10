// Speech metrics (spec → Metrics, ticket 08): measured after the Session from each Answer's verbatim transcript, with
// word timings from gemini-3.5-transcribe. An Answer whose transcript has no timings (it failed, or the fallback model
// served it) keeps its audio for a retry; the audio goes as soon as the turn has a timed transcript.
import { HOLDING_PHRASES } from "../content/practice";
import type { AnswerMetrics, CoachAdapter, PendingAnswer, SessionMetrics, SessionRecord, Store, TranscriberAdapter, Transcript } from "./types";

/** Recent Sessions in a trend line (about two weeks at four a week). */
export const TREND_SESSIONS = 8;

// Fillers follow the learner's course (lessons 0001, 0002 and the drills' filler check): hesitation sounds, "like",
// "you know", "I mean", "kind of", "sort of", "basically", "actually". "So", "yeah" and "right" aren't counted: the
// course counts "so" only when it is empty, and a "So…" that opens a Paraphrase or the so what is real content.
const HESITATION = /^(?:u+m+|u+h+m*|e+r+m*|a+h+|h+m+|m+h*m+)$/;
const SINGLE_FILLERS = new Set(["basically", "actually"]);
/** Two-word fillers, unless the word before makes them literal ("do you know", "what I mean", "a kind of"). */
const AFTER_DETERMINER = new Set(["a", "the", "what", "this", "that", "any", "some", "every", "same", "which", "one"]);
const PAIR_FILLERS: { words: [string, string]; literalAfter: Set<string> }[] = [
  { words: ["you", "know"], literalAfter: new Set(["do", "did", "don't", "didn't", "if", "would", "you'd", "to"]) },
  { words: ["i", "mean"], literalAfter: new Set(["what", "if", "don't", "didn't"]) },
  { words: ["kind", "of"], literalAfter: AFTER_DETERMINER },
  { words: ["sort", "of"], literalAfter: AFTER_DETERMINER },
];
/**
 * "like" is a filler where it starts a clause or stands alone ("On weekends, like, a table…", "if like weekend sales…",
 * "small places like because…"), not as a verb or comparison ("I like it", "places like this").
 */
const CONJUNCTIONS = new Set(["and", "but", "so", "or", "because", "if"]);

interface Token { word: string; startMs: number; boundaryBefore: boolean; commaAfter: boolean }

const norm = (w: string) => w.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9']/g, "");

function tokens(words: Transcript["words"]): Token[] {
  const out: Token[] = [];
  let boundary = true;
  for (const w of words) {
    const word = norm(w.text);
    if (!word) {
      boundary = true; // a dash or other punctuation on its own
      continue;
    }
    out.push({ word, startMs: w.startMs, boundaryBefore: boundary, commaAfter: /,\s*$/.test(w.text) });
    boundary = /[.,;:?!—–-]\s*$/.test(w.text);
  }
  return out;
}

/** For each token, whether it is (part of) a filler; and how many fillers there are (a two-word one counts once). */
function fillers(ts: Token[]): { mask: boolean[]; count: number } {
  const mask = ts.map(() => false);
  let count = 0;
  for (let i = 0; i < ts.length; i++) {
    const { word } = ts[i];
    const prev = ts[i - 1];
    const pair = PAIR_FILLERS.find((p) => word === p.words[0] && ts[i + 1]?.word === p.words[1]);
    if (pair) {
      if (prev && !prev.commaAfter && pair.literalAfter.has(prev.word)) continue;
      mask[i] = mask[i + 1] = true;
      count++;
      i++;
      continue;
    }
    const next = ts[i + 1]?.word ?? "";
    const like = word === "like" && (ts[i].boundaryBefore || ts[i].commaAfter || mask[i - 1] ||
      CONJUNCTIONS.has(prev?.word ?? "") || CONJUNCTIONS.has(next) || HESITATION.test(next));
    if (HESITATION.test(word) || SINGLE_FILLERS.has(word) || like) {
      mask[i] = true;
      count++;
    }
  }
  return { mask, count };
}

const phraseWords = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);
const HOLDING = HOLDING_PHRASES.map((p) => {
  const cue = phraseWords(p.cue);
  const words = phraseWords(p.text);
  return { cue, rest: words.slice(words.indexOf(cue.at(-1)!) + 1) };
});

/**
 * Holding phrases used. A match takes in the rest of the phrase as said (fillers and one dropped word allowed), so
 * "Not fully assessed yet — my first read is" counts once, not twice.
 */
function holdingPhrases(ts: Token[], fillerMask: boolean[]): number {
  let count = 0;
  for (let i = 0; i < ts.length; i++) {
    const p = HOLDING.find((h) => h.cue.every((w, k) => ts[i + k]?.word === w));
    if (!p) continue;
    count++;
    let j = i + p.cue.length;
    for (let k = 0; j < ts.length && k < p.rest.length;) {
      if (fillerMask[j]) j++;
      else if (ts[j].word === p.rest[k]) { j++; k++; }
      else if (ts[j].word === p.rest[k + 1]) k++;
      else break;
    }
    i = j - 1;
  }
  return count;
}

/** One Answer's metrics from its timed transcripts (all but answerFirst, which the Coach brain judges). */
function measureAnswer(a: PendingAnswer): AnswerMetrics {
  const turns = a.turns.map((t) => tokens(t.transcript!.words));
  const counted = turns.map(fillers);
  // The first word of substance is the first that isn't a filler, maybe in a later turn ("Um…", a long pause, then the
  // Answer). A Holding phrase is substance: it starts the Answer.
  const t = turns.findIndex((ts, k) => ts.some((_, i) => !counted[k].mask[i]));
  const first = t < 0 ? undefined : turns[t].find((_, i) => !counted[t].mask[i]);
  const after = t < 0 ? undefined : a.turns[t].startedAfterMs;
  const latency = first && after !== undefined ? Math.max(0, Math.round(after + first.startMs)) : undefined;
  return {
    kind: a.kind,
    ...(latency !== undefined ? { latencyMs: latency } : {}),
    fillers: counted.reduce((n, c) => n + c.count, 0),
    speechMs: a.turns.reduce((n, t) => n + t.speechMs, 0),
    holdingPhrases: turns.reduce((n, ts, k) => n + holdingPhrases(ts, counted[k].mask), 0),
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round1 = (x: number) => Math.round(x * 10) / 10;

const answerText = (a: PendingAnswer) => a.turns.map((t) => t.transcript?.text.trim() ?? "").filter(Boolean).join(" ");

/** The Session's metrics, once every Answer has a timed transcript. The Coach brain judges the first sentences. */
export async function measureSession(answers: PendingAnswer[], coach: CoachAdapter): Promise<SessionMetrics> {
  const measured = answers.map(measureAnswer);
  const judged = answers.flatMap((a, i) => (answerText(a) ? [{ i, question: a.question, answer: answerText(a) }] : []));
  if (judged.length) {
    try {
      const verdicts = await coach.answerFirst({ answers: judged.map(({ question, answer }) => ({ question, answer })) });
      if (verdicts.length === judged.length) judged.forEach(({ i }, k) => { measured[i].answerFirst = verdicts[k]; });
    } catch { /* shown without it */ }
  }
  const latencies = measured.flatMap((m) => (m.latencyMs !== undefined ? [m.latencyMs] : []));
  const speechMs = measured.reduce((n, m) => n + m.speechMs, 0);
  const fillerCount = measured.reduce((n, m) => n + m.fillers, 0);
  const verdicts = measured.flatMap((m) => (m.answerFirst !== undefined ? [m.answerFirst] : []));
  return {
    answers: measured,
    ...(latencies.length ? { responseLatencyMs: Math.round(median(latencies)) } : {}),
    fillersPerMinute: speechMs ? round1(fillerCount / (speechMs / 60_000)) : 0,
    answerSeconds: measured.length ? round1(speechMs / measured.length / 1000) : 0,
    ...(verdicts.length ? { answerFirst: { yes: verdicts.filter(Boolean).length, of: verdicts.length } } : {}),
    holdingPhrases: measured.reduce((n, m) => n + m.holdingPhrases, 0),
  };
}

/** A transcript the metrics can use: it has word timings. */
export const hasWordTimings = (t: Transcript | null | undefined): t is Transcript => !!t && !t.untimed;

export const allTranscribed = (answers: PendingAnswer[]) => answers.every((a) => a.turns.every((t) => t.transcript));

/**
 * gemini-3.5-transcribe allows 10 requests a minute (and 100 a day): retries go one at a time, this far apart, so they
 * neither hit the limit themselves nor use up a call's share of it.
 */
export const RETRY_GAP_MS = 6500;
/** A Session whose Answers still aren't all transcribed after this many app opens gives up: its audio is deleted. */
export const MAX_RETRY_OPENS = 10;

/** How retries are paced: wait between requests; stop (a call has started) ends them early. */
export interface Pace {
  wait(ms: number): Promise<void>;
  stop?(): boolean;
}

/** Transcribes the turns that still have only audio, one at a time. A turn's audio is dropped once it has a timed transcript. */
export async function transcribeMissing(answers: PendingAnswer[], transcriber: TranscriberAdapter, pace: Pace): Promise<void> {
  const missing = answers.flatMap((a) => a.turns).filter((t) => !t.transcript && t.audio);
  for (const [i, t] of missing.entries()) {
    if (i) await pace.wait(RETRY_GAP_MS);
    if (pace.stop?.()) return;
    const transcript = await transcriber.transcribe(t.audio!).catch(() => null);
    if (!hasWordTimings(transcript)) continue;
    t.transcript = transcript;
    delete t.audio;
  }
}

/**
 * Tries again to measure the Sessions whose Answers couldn't all be transcribed (at app start). Each one measured gets
 * its metrics and loses its kept audio; one deleted in the meantime just loses its audio; one still missing Answers
 * after MAX_RETRY_OPENS tries gives up and loses its audio too.
 */
export async function retryPendingMetrics({ store, transcriber, coach, pace }: { store: Store; transcriber: TranscriberAdapter; coach: CoachAdapter; pace: Pace }) {
  const [pending, sessions] = await Promise.all([store.loadPendingMetrics(), store.loadSessions()]);
  for (const [i, p] of pending.entries()) {
    if (pace.stop?.()) return;
    const record = sessions.find((s) => s.id === p.sessionId);
    if (!record) {
      await store.deletePendingMetrics(p.sessionId);
      continue;
    }
    if (i) await pace.wait(RETRY_GAP_MS);
    await transcribeMissing(p.answers, transcriber, pace);
    if (!allTranscribed(p.answers)) {
      if (pace.stop?.()) return void (await store.savePendingMetrics(p));
      const tries = (p.tries ?? 0) + 1;
      if (tries < MAX_RETRY_OPENS) {
        await store.savePendingMetrics({ ...p, tries });
        continue;
      }
      const latest = (await store.loadSessions()).find((s) => s.id === p.sessionId);
      if (latest) {
        const { metricsPending: _, ...rest } = latest;
        await store.replaceSession({ ...rest, metricsUnavailable: true });
      }
      await store.deletePendingMetrics(p.sessionId);
      continue;
    }
    const metrics = await measureSession(p.answers, coach);
    // Read again: the record may have changed while this ran (a late Next focus).
    const latest = (await store.loadSessions()).find((s) => s.id === p.sessionId);
    if (latest) {
      const { metricsPending: _, ...rest } = latest;
      await store.replaceSession({ ...rest, metrics });
    }
    await store.deletePendingMetrics(p.sessionId);
  }
}

export type TrendMetric = "responseLatency" | "fillerRate" | "answerLength" | "answerFirst";

const VALUE: Record<TrendMetric, (m: SessionMetrics) => number | undefined> = {
  responseLatency: (m) => m.responseLatencyMs,
  fillerRate: (m) => m.fillersPerMinute,
  answerLength: (m) => m.answerSeconds,
  answerFirst: (m) => (m.answerFirst?.of ? m.answerFirst.yes / m.answerFirst.of : undefined),
};

/**
 * A metric across recent Sessions, oldest first, ending with `upTo` (the Session the summary shows): the last
 * TREND_SESSIONS that have a value for it.
 */
export function trend(sessions: SessionRecord[], upTo: SessionRecord, metric: TrendMetric): number[] {
  const others = sessions.filter((s) => s.id !== upTo.id && s.startedAt < upTo.startedAt);
  return [...others.sort((a, b) => a.startedAt - b.startedAt), upTo]
    .flatMap((s) => {
      const v = s.metrics && VALUE[metric](s.metrics);
      return v === undefined ? [] : [v];
    })
    .slice(-TREND_SESSIONS);
}


/** Whether a lower value is the better one. */
const LOWER_IS_BETTER: Record<TrendMetric, boolean> = { responseLatency: true, fillerRate: true, answerLength: false, answerFirst: false };

/** How this Session's value compares with the learner's recent average. "first": no earlier Session to compare with. */
export interface MetricInsight {
  metric: TrendMetric;
  value: number;
  /** Mean of the earlier Sessions in the trend (up to TREND_SESSIONS − 1). */
  average?: number;
  change: "better" | "worse" | "same" | "first";
  /** Better than every earlier Session in the trend. */
  best: boolean;
}

/** Within this much of the average counts as the same: 10% of it, or 5 points for the share of Answers first. */
const sameAs = (metric: TrendMetric, value: number, average: number) =>
  metric === "answerFirst" ? Math.abs(value - average) <= 0.05 : Math.abs(value - average) <= 0.1 * average;

export function insight(sessions: SessionRecord[], record: SessionRecord, metric: TrendMetric): MetricInsight | null {
  const value = record.metrics && VALUE[metric](record.metrics);
  if (value === undefined) return null;
  const earlier = trend(sessions, record, metric).slice(0, -1);
  if (!earlier.length) return { metric, value, change: "first", best: false };
  const average = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const better = (a: number, b: number) => (LOWER_IS_BETTER[metric] ? a < b : a > b);
  const change = sameAs(metric, value, average) ? "same" : better(value, average) ? "better" : "worse";
  return { metric, value, average, change, best: earlier.every((v) => better(value, v)) };
}

/** How far from the average, relative to it, so different metrics can be ranked. */
const size = (i: MetricInsight) =>
  i.metric === "answerFirst" ? Math.abs(i.value - i.average!) : Math.abs(i.value - i.average!) / Math.max(i.average!, 1e-9);

/**
 * The one change to point out at the top of the summary: the biggest improvement (the Answer first wins a tie, as
 * the course's core habit), else the biggest slip; null when there is nothing to compare or nothing changed.
 */
export function headlineInsight(insights: MetricInsight[]): MetricInsight | null {
  const ranked = (change: MetricInsight["change"]) =>
    insights.filter((i) => i.change === change).sort((a, b) => size(b) - size(a) || Number(b.metric === "answerFirst") - Number(a.metric === "answerFirst"));
  return ranked("better")[0] ?? ranked("worse")[0] ?? null;
}
