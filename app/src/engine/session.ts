import {
  PRE_ROLL_MS,
  type AnswerAudio, type CallView, type CoachingPoint, type EndReason, type Exchange, type FollowUpType, type LiveEvent, type MeasuredKind,
  type NextFocusInput, type PendingAnswer, type QuestionMarks, type RoundNumber, type RoundRecord, type Session, type SessionDeps,
  type SessionRecord, type SessionSummary, type Step, type ThreadItem, type Transcript,
} from "./types";
import { allTranscribed, hasWordTimings, measureSession, transcribeMissing } from "./metrics";
import { THINKING_PATTERNS, type HoldingPhrase, type ThinkingPattern } from "../content/practice";
import type { BankQuestion, Category, QuestionBank, SessionQuestions } from "../content/scene";

export const FOLLOW_UP_LABEL: Record<FollowUpType, string> = {
  why: "Why",
  soWhat: "So what",
  counterexample: "Counterexample",
  changeYourMind: "What would change your mind",
  beSpecific: "Be specific",
  haveYouConsidered: "Have you considered…?",
  hostileFraming: "Hostile framing",
};

const FOLLOW_UP_ASK: Record<FollowUpType, string> = {
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

/**
 * What the Partner is told for a Follow-up. It's sent before the Answer, so it carries the type and how to build on the
 * Answer, never a ready-made line: given one, the Partner reads it out whatever the learner said (ticket 09).
 */
const followUpNote = (type: FollowUpType) =>
  `ask one Follow-up of type "${FOLLOW_UP_LABEL[type]}": ${FOLLOW_UP_ASK[type]}. ` +
  `Build it on one specific thing they just said (a word, a number, an example, or a condition such as "it depends on…"). ` +
  `Never ask a generic question that would fit any answer, and never assume a side they didn't take. ` +
  `If their answer made no call (for example "it depends on…" with both sides left open), shape this same ` +
  `"${FOLLOW_UP_LABEL[type]}" question so that answering it forces them to make the call for this case. ` +
  `If they did make a call, don't ask them to choose a side.`;

// 2–3 Follow-ups per Round: a third only while the Round is inside its share of a ~10-min Session.
const MIN_FOLLOW_UPS = 2;
const MAX_FOLLOW_UPS = 3;
const ROUND_BUDGET_MS = 150_000;

const TYPE_ORDER: FollowUpType[] = ["why", "soWhat", "counterexample", "changeYourMind", "beSpecific", "haveYouConsidered", "hostileFraming"];

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []);

/** The learner asked "could you repeat that?" and the Partner said its last question again (maybe with a lead-in). */
function repeatsQuestion(text: string, question: string) {
  const asked = words(question);
  if (asked.size < 3) return false;
  const said = words(text);
  return [...asked].filter((w) => said.has(w)).length / asked.size >= 0.7;
}

function bubbleFor(step: Step): Extract<ThreadItem, { kind: "partner" }> {
  if (step.kind === "followUp") return { kind: "partner", step: "followUp", followUpType: step.type, text: "" };
  const kind = step.kind === "main" || step.kind === "redo" || step.kind === "transfer" ? step.kind : "wrapUp";
  return { kind: "partner", step: kind, text: "" };
}

/** A Session takes its three questions (two Rounds and the Transfer question) from one Scene. */
const QUESTIONS_PER_SESSION = 3;

/**
 * The Scene and questions for the next Session: three that are neither seen nor struck, from one Scene in the chosen
 * category (null: any), picked at random. Null when no Scene has three left.
 */
export function chooseQuestions(
  bank: QuestionBank, marks: QuestionMarks, category: Category | null, random: () => number = Math.random,
): SessionQuestions | null {
  const used = usedIds(marks);
  const left = bank.questions.filter((q) => !used.has(q.id) && (!category || q.category === category));
  const scenes = bank.scenes.filter((s) => left.filter((q) => q.sceneId === s.id).length >= QUESTIONS_PER_SESSION);
  if (!scenes.length) return null;
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const scene = pick(scenes);
  const pool = left.filter((q) => q.sceneId === scene.id);
  const chosen: BankQuestion[] = [];
  while (chosen.length < QUESTIONS_PER_SESSION) {
    const q = pick(pool.filter((x) => !chosen.includes(x)));
    chosen.push(q);
  }
  return { scene, rounds: [chosen[0], chosen[1]], transfer: chosen[2] };
}

const usedIds = (marks: QuestionMarks) => new Set([...marks.seen, ...marks.struck]);

/** False once any of the Session's questions has been seen or struck, so it needs choosing again. */
export function stillUnused(questions: SessionQuestions, marks: QuestionMarks): boolean {
  const used = usedIds(marks);
  return ![...questions.rounds, questions.transfer].some((q) => used.has(q.id));
}

/** The Next focus the coming Session opens with: the latest one saved. */
export function lastNextFocus(sessions: SessionRecord[]): string | null {
  // Oldest first (Store.loadSessions); a Session that ended without one leaves the one before it standing.
  return [...sessions].reverse().find((s) => s.nextFocus)?.nextFocus ?? null;
}

/**
 * Today's Thinking pattern. While some pattern has never been introduced, it's the first of those and the Partner
 * introduces it (one per Session; a Session that ended before the Partner said it doesn't count). After that, the
 * pattern used least so far, and it appears only through the Hint.
 */
export function todaysPattern(sessions: SessionRecord[]): { pattern: ThinkingPattern; introduce: boolean } {
  const introduced = new Set(sessions.flatMap((s) => (s.patternIntroduced && s.thinkingPattern ? [s.thinkingPattern] : [])));
  const fresh = THINKING_PATTERNS.find((p) => !introduced.has(p.id));
  if (fresh) return { pattern: fresh, introduce: true };
  const uses = (p: ThinkingPattern) => sessions.filter((s) => s.thinkingPattern === p.id).length;
  return { pattern: [...THINKING_PATTERNS].sort((a, b) => uses(a) - uses(b))[0], introduce: false };
}

function timesFaced(sessions: SessionRecord[]): Record<FollowUpType, number> {
  const counts = Object.fromEntries(TYPE_ORDER.map((t) => [t, 0])) as Record<FollowUpType, number>;
  for (const s of sessions) for (const r of s.rounds) for (const t of r.followUpTypes) counts[t]++;
  return counts;
}

/** What the Partner's next turn will be. */
type PartnerTurn =
  /** The reminder of the last Session's Next focus and the Thinking pattern's introduction. */
  | { kind: "opening" }
  | { kind: "question"; step: Step }
  /** A short line covering a wait for the Coach brain. */
  | { kind: "cover" }
  /** The Coaching point, then the Main question again for the Redo. */
  | { kind: "redo"; point: CoachingPoint }
  | { kind: "betterVersion"; text: string }
  | { kind: "transferComment"; text: string }
  /** A short line while the learner reads the Better version. */
  | { kind: "nudge" }
  | { kind: "wrapUp"; reason: "complete" | "timeCap" };

/** Work for the Coach brain that the Partner covers with short lines. */
type WaitKind = "coachingPoint" | "betterVersion" | "transferComment" | "nextFocus";

/** One learner turn: an Answer can span several. The audio is kept for the metrics until the turn has a timed transcript. */
interface AnswerTurn {
  transcript: Promise<Transcript | null>;
  audio?: AnswerAudio;
  speechMs: number;
  /** Its audio starts this long after the Partner's question ended; none if the learner cut in (see PendingAnswer). */
  startedAfterMs?: number;
}

/** Everything the learner said in reply to one Partner question. */
interface AnswerRecord {
  to: { step: Step; text: string };
  turns: AnswerTurn[];
  redo: boolean;
  /** Said while the Partner was covering a wait; not part of the Round's Answers. */
  aside: boolean;
}

/** If the Coach brain isn't back this long after the Partner falls quiet, the Partner says another covering line. */
const COVER_AFTER_MS = 1000;
// They promise nothing: the Coach brain may still fail, and then no Coaching point or comment comes.
const COVER_LINES = {
  coachingPoint: ["Bear with me a moment.", "Nearly there.", "Sorry, just a moment longer."],
  betterVersion: ["Nearly there.", "Bear with me a second.", "Sorry, just a moment longer."],
  // The Next focus is asked for with the Transfer comment, and the two waits share these lines.
  close: ["Bear with me a moment.", "Nearly there.", "Sorry, just a moment longer."],
};
/** A speak() that brings no Partner turn this long (lost in a reconnect, or no audio) is sent again. */
const SPEAK_RETRY_MS = 8000;
const SPEAK_RETRIES = 2;
/**
 * A [Director] instruction for the Partner's next reply. `note` is set while the learner hasn't spoken yet; `now` has
 * the Partner give that reply at once, when it was lost (a wordless turn, a reconnect) after the learner spoke.
 */
interface ReplyNote { note: string; now: string }
const replyNote = (when: string, what: string): ReplyNote => ({
  note: `[Director] ${when} ${what}`,
  now: `[Director] The learner has just finished speaking. Now ${what}`,
});
const STILL_WAITING = replyNote(
  "You are still preparing. If the learner speaks now,",
  'reply only with one short line such as "One moment, I\'m nearly there." Do not give feedback and do not ask anything.',
);
const sayExactly = (text: string) => `[Director] Say exactly this, word for word, and nothing else: "${text}"`;
/** The same, as the Partner's reply when the learner's turn ends. */
const replyExactly = (text: string) => `[Director] When the learner finishes, say exactly this, word for word, and nothing else: "${text}"`;
/** Before the next question when the learner didn't tap Next. */
const MOVE_ON = "Let's move on. ";
/** Before the next question when the Round closes without a Coaching point or Better version. */
const NO_POINT = "Sorry, I couldn't put a point together on that one. Let's move on. ";
/** The Coaching point and the Redo already happened: only the rewrite is missing. */
const NO_BETTER_VERSION = "Sorry, I couldn't write up a tighter version this time. Let's move on. ";
/** Nothing was transcribed: the Coach brain would judge an empty Answer. */
class NothingTranscribed extends Error {}
// The call screen gives way to the summary as soon as the Partner finishes, so the close says so. It carries the Next
// focus when the Coach brain has it ready.
const closing = (focus: string | undefined) =>
  `${focus ? `Your Next focus for next time: ${focus} ` : ""}Have a look at the summary on your screen. Thanks, and see you next time.`;
const wrapUpLine = (focus: string | undefined) => `That's the end of the Session. ${closing(focus)}`;
const timeUpLine = (focus: string | undefined) => `We're out of time, so let's stop there. ${closing(focus)}`;
// Short: the pattern's skeleton and example are on the screen, and the Next focus is one line of at most ~12 words.
const openingLine = (focus: string | null, intro: string | null) =>
  ["Hi.", focus && `Your focus from last time: ${focus}`, intro].filter(Boolean).join(" ");
/** The Partner wraps up at about 12:00, even in the middle of a Round. */
const TIME_CAP_MS = 12 * 60_000;
/**
 * A turn not transcribed with word timings during the call is tried again this many times after the Session, this far
 * apart: gemini-3.5-transcribe allows 10 requests a minute, and a refusal makes the Worker use the untimed fallback.
 */
const TRANSCRIBE_RETRIES = 2;
const TRANSCRIBE_RETRY_MS = 30_000;
/** A transcript still not back this long after the Session ended is taken as failed (a request can hang). */
const TRANSCRIPT_WAIT_MS = 30_000;
/** If the wrap-up never comes, the Session ends anyway this long after the time cap. */
const WRAP_UP_GRACE_MS = 60_000;
/** If the learner hasn't tapped Next this long after the Partner pointed at the Better version, the Session moves on. */
const READING_MS = 30_000;
const THINK = replyNote(
  "When the learner finishes this answer,",
  'say only: "Okay, let me think about that for a second." Do not comment on their answer, give feedback or ask anything.',
);
const READING = replyNote(
  "The learner is reading the Better version on their screen. If they speak now,",
  'reply only: "Take your time. Tap Next when you\'re ready." Nothing else.',
);
const THANKS = replyNote(
  "When the learner finishes,",
  'say only: "Thanks. I\'ll put a tighter version of your answer on the screen." Nothing else: no feedback, no question.',
);
/** A Partner turn with no words (the server sometimes sends one) is asked for again, at most this many times. */
const WORDLESS_RETRIES = 2;

/** One Round's own state. */
interface RoundState {
  n: RoundNumber;
  question: BankQuestion;
  /** Follow-up types planned in this Round, in order (the last may not have been asked yet). */
  asked: FollowUpType[];
  startedAt: number | null;
  /** Where the Round starts in the thread. */
  threadFrom: number;
  answers: AnswerRecord[];
  coachingPoint?: CoachingPoint;
  /** The Redo's transcript, once the Better version has been asked for. */
  redo?: string;
  betterVersion?: string;
}

export function createSession({
  live, clock, store, questions, coach, transcriber, keepGoing = false, timeCapMs = TIME_CAP_MS, practice,
}: SessionDeps): Session {
  let view: CallView = { step: null, activity: "idle", thread: [], canDone: false, canNext: false, startedAt: null, pattern: null, hint: null };
  const listeners = new Set<(v: CallView) => void>();
  const newRound = (n: RoundNumber): RoundState =>
    ({ n, question: questions.rounds[n - 1], asked: [], startedAt: null, threadFrom: -1, answers: [] });
  /** Question bank entries the Partner has asked, in order; each is marked seen as it's asked. */
  const askedIds: string[] = [];
  function markAsked(q: BankQuestion) {
    if (askedIds.includes(q.id)) return;
    askedIds.push(q.id);
    store.markSeen(q.id).catch(() => {});
  }
  const rounds: RoundState[] = [newRound(1)];
  const round = () => rounds.at(-1)!;
  /** Past Sessions, loaded at start. */
  let history: SessionRecord[] = [];
  /** The Coach brain's Next focus: asked for once, with the Transfer Answer or when the Session ends. */
  /** gen: a later request (the Transfer Answer grew) makes an earlier one's result stale. */
  const focus: { request: Promise<string | null> | null; text?: string; settled?: boolean; gen: number } = { request: null, gen: 0 };
  /** What the Partner opened with (the Next focus reminder, the pattern's introduction), if anything. */
  let openedWith: string | null = null;
  /** Today's Thinking pattern, once history is loaded; none without the learner's Holding phrases. */
  let today: { pattern: ThinkingPattern; introduce: boolean } | null = null;
  /** The Partner has said the pattern's introduction. */
  let introduced = false;
  let hintUses = 0;
  /** Shared by the waits for the Transfer comment and the Next focus, which run together. */
  const closeCoverLines = [...COVER_LINES.close];
  let summary: SessionSummary | null = null;
  /** Set once the Session moves on to the Transfer question. */
  let transfer: { answers: AnswerRecord[]; threadFrom: number; comment?: string } | null = null;
  /** Where the learner's Answers go now. */
  const answersNow = () => transfer?.answers ?? round().answers;
  /** The standing instruction for the Partner's next reply, what that reply will be, and what to start when the learner finishes. */
  let plan: { reply: ReplyNote; turn: PartnerTurn; startWhenAnswered?: WaitKind } | null = null;
  /** What the Partner's next turn will be. */
  let expected: PartnerTurn = { kind: "question", step: { kind: "main", round: 1 } };
  /** What the Partner is saying now (or said last), the instruction that brought it, and the step before it. */
  let currentTurn: PartnerTurn | null = null;
  let currentSource: { instruction: string | null; stepBefore: Step | null } = { instruction: null, stepBefore: null };
  /** Everything the Partner has said in its current turn, whatever the thread shows for it. */
  let turnText = "";
  let wordlessRetries = 0;
  let answerMs = 0;
  let activityBeforeResume: CallView["activity"] = "yourTurn";
  /** The Partner's last question, to recognise it being repeated. */
  let lastQuestion: { step: Step; text: string } | null = null;
  let learnerTurnOpen = false;
  /** When the Partner's last turn ended (null if the learner cut it off), and when the learner's turn opened. */
  let partnerEndedAt: number | null = null;
  let turnOpenedAt = 0;
  let replyPending = false;
  let partnerSpeaking = false;
  /** A speak() whose Partner turn hasn't started yet. */
  let unspoken: { turn: PartnerTurn; instruction: string; retries: number; cancelTimer: () => void } | null = null;
  /**
   * Something the Partner must say once it is quiet: a speak() the learner talked over before the Partner started, or
   * the next question when the learner tapped Next while the Partner was busy.
   */
  let speakWhenQuiet: { turn: PartnerTurn; instruction: string } | null = null;
  /** The time cap has passed: the next thing the Partner says is the wrap-up. */
  let timeUp = false;
  /** The learner is reading the Better version; Next (or this timer) moves on. */
  let reading: { cancelTimer: () => void } | null = null;
  let wait: {
    kind: WaitKind;
    /** Set when the Coach brain is back (or has failed): what the Partner says next. */
    deliver?: () => void;
    /** What the Partner says if the Coach brain fails or is still not back after the covering lines. */
    giveUp: () => void;
    coverLines: string[];
    cancelTimer?: () => void;
  } | null = null;

  const update = (patch: Partial<CallView>) => {
    view = { ...view, ...patch };
    listeners.forEach((l) => l(view));
    syncHold();
  };

  /** A proactive connection swap now would add its gap to a wait the learner already hears. */
  let holding = false;
  function syncHold() {
    const hold = view.step?.kind !== "ended" && (wait !== null || speakWhenQuiet !== null);
    if (hold === holding) return;
    holding = hold;
    live.holdSwap(hold);
  }

  const partnerBusy = () => learnerTurnOpen || replyPending || partnerSpeaking;

  function setPlan(next: NonNullable<typeof plan>) {
    plan = next;
    expected = next.turn;
    live.setNextReply(next.reply.note);
  }

  function speak(turn: PartnerTurn, instruction: string, retries = 0) {
    unspoken?.cancelTimer();
    expected = turn;
    replyPending = true;
    live.speak(instruction);
    unspoken = { turn, instruction, retries, cancelTimer: () => {} };
    armRetry(unspoken);
  }

  /**
   * Sends a speak() again if it brings no Partner turn in time. Paused while the connection is resuming (the adapter
   * queues and flushes it), so a slow reconnect never makes the Partner say it twice. After the time cap it is replaced
   * by the wrap-up instead.
   */
  function armRetry(u: NonNullable<typeof unspoken>) {
    u.cancelTimer = clock.after(SPEAK_RETRY_MS, () => {
      if (unspoken !== u || view.step?.kind === "ended") return;
      if (timeUp && u.turn.kind !== "wrapUp") return sayTimeUp();
      if (u.retries < SPEAK_RETRIES) speak(u.turn, u.instruction, u.retries + 1);
    });
  }

  /** Speaks now, or as soon as the Partner is quiet and the learner's turn is closed. */
  function speakSoon(turn: PartnerTurn, instruction: string) {
    if (!partnerBusy()) return speak(turn, instruction);
    speakWhenQuiet = { turn, instruction };
    syncHold();
  }

  function planNextReply() {
    const r = round();
    const roundRanLong = r.startedAt !== null && clock.now() - r.startedAt >= ROUND_BUDGET_MS;
    if (!keepGoing && (r.asked.length >= MAX_FOLLOW_UPS || (r.asked.length >= MIN_FOLLOW_UPS && roundRanLong))) {
      return setPlan({ turn: { kind: "cover" }, startWhenAnswered: "coachingPoint", reply: THINK });
    }
    // Least faced first, counting past Sessions and the Rounds of this one.
    const faced = timesFaced(history);
    for (const t of rounds.flatMap((x) => (x === r ? [] : x.asked))) faced[t]++;
    // Each type once per Round before any repeats (repeats only happen in keepGoing mode).
    const thisCycle = r.asked.slice(r.asked.length - (r.asked.length % TYPE_ORDER.length));
    const type = TYPE_ORDER.filter((t) => !thisCycle.includes(t)).sort((a, b) => faced[a] - faced[b])[0];
    r.asked.push(type);
    setPlan({
      turn: { kind: "question", step: { kind: "followUp", round: r.n, n: r.asked.length, type } },
      reply: replyNote("When the learner finishes this answer,", followUpNote(type)),
    });
  }

  /**
   * Closes the Round or the Transfer question and goes on: Round 2, the Transfer question, then the wrap-up. `lead`
   * ("Let's move on.") replaces the question's usual lead-in.
   */
  function moveOn(lead = "") {
    if (transfer) return wrapUp();
    if (round().n === 1) {
      rounds.push(newRound(2));
      const step: Step = { kind: "main", round: 2 };
      return speakSoon({ kind: "question", step }, sayExactly(`${lead || "Second question. "}${round().question.text}`));
    }
    transfer = { answers: [], threadFrom: -1 };
    speakSoon({ kind: "question", step: { kind: "transfer" } }, sayExactly(`${lead || "Last one, quickly. "}${questions.transfer.text}`));
  }

  function startReading() {
    const cancelTimer = clock.after(READING_MS, function readingTimeUp() {
      // Not while the learner is talking or the Partner is answering them: try again a little later.
      if (partnerBusy()) return void (reading = { cancelTimer: clock.after(5000, readingTimeUp) });
      next(MOVE_ON);
    });
    reading = { cancelTimer };
    setPlan({ turn: { kind: "nudge" }, reply: READING });
    update({ activity: "reading", canNext: true });
  }

  function next(lead = "") {
    if (!reading || view.step?.kind === "ended") return;
    reading.cancelTimer();
    reading = null;
    update({ activity: "partnerThinking", canNext: false });
    moveOn(lead);
  }

  // ---------- time cap ----------

  const timeUpTurn: PartnerTurn = { kind: "wrapUp", reason: "timeCap" };
  const sayTimeUp = () => speak(timeUpTurn, sayExactly(timeUpLine(focus.text)));
  /**
   * The learner's turn is open: ask for the wrap-up as the reply to it. A note sent during an open turn often doesn't
   * change the reply already planned (a Live API check: 1 of 4), and a speak() on top would make the Partner say two
   * things, so the reply is judged by what the Partner actually says (see partnerTurnEnded).
   */
  const planTimeUp = () => live.setNextReply(replyExactly(timeUpLine(focus.text)));
  const saysTimeUp = (text: string) => /out of time/i.test(text);

  function onTimeCap() {
    if (view.step?.kind === "ended" || timeUp) return;
    timeUp = true;
    // Nothing new starts: no Coaching point or Better version still being prepared, no Next, nothing queued.
    cancelWait();
    reading?.cancelTimer();
    reading = null;
    speakWhenQuiet = null;
    clock.after(WRAP_UP_GRACE_MS, () => finish("timeCap"));
    update({ canNext: false });
    if (learnerTurnOpen) return planTimeUp();
    if (unspoken) {
      // The Partner was told to say something and hasn't started. Let it come rather than queue a second line on top
      // (it ends in the wrap-up); if it never comes, wrap up instead of sending it again.
      unspoken.cancelTimer();
      return armRetry(unspoken);
    }
    // A reply that is on its way or being spoken ends in the wrap-up (see partnerTurnEnded).
    if (!partnerBusy()) sayTimeUp();
  }

  // ---------- waiting for the Coach brain ----------

  const transcriptOf = async (a: AnswerRecord) =>
    (await Promise.all(a.turns.map((t) => t.transcript))).map((t) => t?.text.trim() ?? "").filter(Boolean).join(" ");

  async function roundExchanges(r: RoundState): Promise<Exchange[]> {
    const firstAnswers = r.answers.filter((a) => !a.redo && !a.aside);
    return Promise.all(
      firstAnswers.map(async (a) => ({
        question: a.to.text.trim(),
        ...(a.to.step.kind === "followUp" ? { followUpType: a.to.step.type } : {}),
        answer: await transcriptOf(a),
      })),
    );
  }

  const redoOf = async (r: RoundState) => (await Promise.all(r.answers.filter((a) => a.redo).map(transcriptOf))).join(" ");
  const transferAnswer = async () =>
    transfer ? (await Promise.all(transfer.answers.filter((a) => !a.aside).map(transcriptOf))).join(" ") : "";
  /** Round 2 counts once it was asked. */
  const startedRounds = () => rounds.filter((r, i) => i === 0 || r.threadFrom >= 0);

  /**
   * Asks the Coach brain for the Next focus: once, or again when `restart` (the Transfer Answer grew). Resolves to null
   * if there's nothing to base it on, or it failed.
   */
  function requestNextFocus(restart = false): Promise<string | null> {
    if (focus.request && !restart) return focus.request;
    const gen = ++focus.gen;
    focus.text = undefined;
    focus.settled = false;
    focus.request = (async () => {
      const input: NextFocusInput = {
        rounds: await Promise.all(startedRounds().map(async (r) => {
          const redo = await redoOf(r);
          return { mainQuestion: r.question.text, ...(r.coachingPoint ? { coachingPoint: r.coachingPoint } : {}), ...(redo ? { redo } : {}) };
        })),
      };
      const answer = await transferAnswer();
      if (answer) input.transfer = { question: questions.transfer.text, answer };
      if (!answer && !input.rounds.some((r) => r.coachingPoint)) return null;
      const text = (await coach.nextFocus(input)).trim();
      if (text && gen === focus.gen) focus.text = text;
      return text || null;
    })().catch(() => null).finally(() => { if (gen === focus.gen) focus.settled = true; });
    return focus.request;
  }

  const sayWrapUp = (nextFocus: string | undefined) => speakSoon({ kind: "wrapUp", reason: "complete" }, sayExactly(wrapUpLine(nextFocus)));

  /** The last thing the Partner says. It waits (covered) for a Next focus that is on its way. */
  function wrapUp() {
    if (!focus.request || focus.settled) return sayWrapUp(focus.text);
    startWait("nextFocus");
    advanceWait();
  }

  /** Asks the Coach brain; resolves to what the Partner says once it's back. */
  async function askCoach(kind: WaitKind): Promise<() => void> {
    if (kind === "nextFocus") {
      const text = await requestNextFocus();
      if (!text) throw new Error("no Next focus");
      return () => sayWrapUp(text);
    }
    if (kind === "transferComment") {
      // Asked again when the learner went on: the Next focus should judge the whole Transfer Answer too.
      void requestNextFocus(true);
      const answer = await transferAnswer();
      if (!answer) throw new NothingTranscribed();
      const coachingPoints = rounds.flatMap((x) => (x.coachingPoint ? [x.coachingPoint] : []));
      const text = await coach.transferComment({ question: questions.transfer.text, answer, coachingPoints });
      return () => deliverTransferComment(text);
    }
    const r = round();
    const exchanges = await roundExchanges(r);
    const mainQuestion = r.question.text;
    if (kind === "coachingPoint") {
      if (exchanges.every((x) => !x.answer)) throw new NothingTranscribed();
      const point = await coach.coachingPoint({ mainQuestion, exchanges });
      return () => deliverCoachingPoint(point);
    }
    const redo = await redoOf(r);
    r.redo = redo || undefined;
    const text = await coach.betterVersion({ mainQuestion, exchanges, coachingPoint: r.coachingPoint!, redo });
    return () => deliverBetterVersion(text);
  }

  /** Starts the Coach brain on the Answer just finished. A restart (the learner went on) drops the earlier request's result. */
  function startWait(kind: WaitKind) {
    cancelWait();
    // Without a Coaching point there is nothing to Redo, and the Partner must not invent one: close the Round instead.
    // Without a Next focus the Partner wraps up without one.
    const giveUp = kind === "nextFocus" ? () => sayWrapUp(undefined)
      : kind === "betterVersion" ? () => moveOn(NO_BETTER_VERSION)
      : () => moveOn(NO_POINT);
    const coverLines = kind === "transferComment" || kind === "nextFocus" ? closeCoverLines : [...COVER_LINES[kind]];
    const w: NonNullable<typeof wait> = { kind, coverLines, giveUp };
    wait = w;
    if (kind === "coachingPoint") update({ step: { kind: "coaching", round: round().n } });
    askCoach(kind).then(
      (deliver) => { w.deliver ??= deliver; },
      () => { w.deliver ??= giveUp; },
    ).then(() => { if (wait === w) advanceWait(); });
    syncHold();
  }

  function cancelWait() {
    wait?.cancelTimer?.();
    wait = null;
    syncHold();
  }

  /** Called whenever the Partner may have fallen quiet or the Coach brain may be back. */
  function advanceWait() {
    advance();
    syncHold();
  }

  function advance() {
    if (view.step?.kind === "ended" || partnerBusy()) return;
    if (speakWhenQuiet) {
      const { turn, instruction } = speakWhenQuiet;
      speakWhenQuiet = null;
      return speak(turn, instruction);
    }
    const w = wait;
    if (!w) return;
    if (w.deliver) {
      w.cancelTimer?.();
      wait = null;
      return w.deliver();
    }
    if (w.cancelTimer) return;
    w.cancelTimer = clock.after(COVER_AFTER_MS, () => {
      w.cancelTimer = undefined;
      if (wait !== w || w.deliver || partnerBusy()) return;
      const line = w.coverLines.shift();
      if (!line) {
        // Every covering line is used up: stop the silence rather than keep waiting.
        w.deliver = w.giveUp;
        return advanceWait();
      }
      speak({ kind: "cover" }, sayExactly(line));
    });
  }

  function deliverCoachingPoint(point: CoachingPoint) {
    round().coachingPoint = point;
    speak({ kind: "redo", point }, sayExactly(`One thing to work on. You said: "${point.quote}" ${point.fix} Let's try it again. ${round().question.text}`));
  }

  function deliverBetterVersion(text: string) {
    round().betterVersion = text;
    speak(
      { kind: "betterVersion", text },
      sayExactly("Have a look at the Better version on your screen. Same position, just tighter. Tap Next when you're ready."),
    );
  }

  function deliverTransferComment(text: string) {
    transfer!.comment = text;
    speak({ kind: "transferComment", text }, sayExactly(text));
  }

  // ---------- Live events ----------

  function onLive(e: LiveEvent) {
    if (view.step?.kind === "ended") return;
    switch (e.type) {
      case "partnerTurnStarted": {
        const turn = (currentTurn = expected);
        currentSource = { instruction: unspoken?.instruction ?? plan?.reply.now ?? null, stepBefore: view.step };
        partnerEndedAt = null;
        turnText = "";
        unspoken?.cancelTimer();
        unspoken = null;
        replyPending = false;
        partnerSpeaking = true;
        let step: Step = view.step!;
        let item: ThreadItem;
        if (turn.kind === "opening") {
          step = { kind: "opening" };
          item = { kind: "partner", step: "opening", text: "" };
        } else if (turn.kind === "question") {
          step = turn.step;
          item = bubbleFor(step);
        } else if (turn.kind === "cover" || turn.kind === "nudge") {
          item = { kind: "partner", step: turn.kind === "cover" ? "covering" : "nudge", text: "" };
        } else if (turn.kind === "redo") {
          item = { kind: "coaching", point: turn.point, redoQuestion: round().question.text };
        } else if (turn.kind === "betterVersion") {
          step = { kind: "betterVersion", round: round().n };
          item = { kind: "betterVersion", text: turn.text };
        } else if (turn.kind === "transferComment") {
          item = { kind: "transferComment", text: turn.text };
        } else {
          step = { kind: "wrapUp" };
          item = bubbleFor(step);
        }
        if (step.kind === "main" && round().startedAt === null) {
          round().startedAt = clock.now();
          round().threadFrom = view.thread.length;
        }
        if (step.kind === "transfer" && transfer && transfer.threadFrom < 0) transfer.threadFrom = view.thread.length;
        // A new question closes the Hint: it was for the one before.
        const hint = turn.kind === "question" || turn.kind === "redo" ? null : view.hint;
        update({ step, thread: [...view.thread, item], activity: "partnerSpeaking", canDone: false, canNext: false, hint });
        break;
      }
      case "partnerText": {
        turnText += e.text;
        const last = view.thread.at(-1);
        if (last?.kind !== "partner") break;
        update({ thread: [...view.thread.slice(0, -1), { ...last, text: last.text + e.text }] });
        break;
      }
      case "partnerTurnEnded": {
        partnerSpeaking = false;
        partnerEndedAt = e.interrupted ? null : clock.now() - (e.sinceAudioEndedMs ?? 0);
        const turn = currentTurn ?? expected;
        if (turn.kind === "wrapUp") return finish(turn.reason);
        if (timeUp) {
          const last = view.thread.at(-1);
          if (last?.kind !== "partner" || !saysTimeUp(last.text)) return sayTimeUp();
          // The reply to the learner's last turn was the wrap-up after all.
          update({ step: { kind: "wrapUp" }, thread: [...view.thread.slice(0, -1), { ...last, step: "wrapUp", followUpType: undefined }] });
          return finish("timeCap");
        }
        // The server sometimes sends a turn with no words (just "..."), as if the Partner had said nothing.
        const wordless = !e.interrupted && !/[a-z0-9]/i.test(turnText);
        if (currentSource.instruction && (e.cut || (wordless && wordlessRetries < WORDLESS_RETRIES))) {
          // Cut off by a reconnect, or no words: take it back and have the Partner say it again in full.
          if (wordless) wordlessRetries++;
          update({ step: currentSource.stepBefore, thread: view.thread.slice(0, -1), activity: "partnerThinking" });
          speak(turn, currentSource.instruction);
          break;
        }
        wordlessRetries = 0;
        const last = view.thread.at(-1);
        const text = last?.kind === "partner" ? last.text : "";
        if ((turn.kind === "question" || turn.kind === "cover") && lastQuestion && repeatsQuestion(text, lastQuestion.text)) {
          // Still the same question: relabel it, and the planned next reply still stands.
          const again: ThreadItem = { ...bubbleFor(lastQuestion.step), text, repeat: true };
          const waitGoesOn = wait !== null && !plan?.startWhenAnswered;
          if (waitGoesOn) {
            // Asked during a wait: the Coach brain keeps working on the Answer it already has.
            update({ thread: [...view.thread.slice(0, -1), again], activity: "partnerThinking" });
          } else {
            // What the learner said was a request to repeat, not an Answer.
            const thread = view.thread.map((t, i) =>
              // The request to repeat is not an Answer.
              i === view.thread.length - 2 && t.kind === "answer" ? { ...t, aside: true } : t);
            update({ step: lastQuestion.step, thread: [...thread.slice(0, -1), again], activity: "yourTurn" });
            answersNow().pop();
            cancelWait();
          }
          if (plan) setPlan(plan);
          advanceWait();
          break;
        }
        switch (turn.kind) {
          case "opening":
            if (today?.introduce) introduced = true;
            speakSoon({ kind: "question", step: { kind: "main", round: 1 } }, sayExactly(`First question. ${round().question.text}`));
            update({ activity: "partnerThinking" });
            break;
          case "question":
            lastQuestion = { step: turn.step, text };
            if (turn.step.kind === "main") markAsked(round().question);
            if (turn.step.kind === "transfer") markAsked(questions.transfer);
            // The Transfer question gets one comment from the Coach brain and no Follow-ups.
            if (turn.step.kind === "transfer") setPlan({ turn: { kind: "cover" }, startWhenAnswered: "transferComment", reply: THINK });
            else planNextReply();
            update({ activity: "yourTurn" });
            break;
          case "cover":
            // The learner may speak while the Coach brain works; the Partner must only cover, not ask or judge.
            setPlan({ turn: { kind: "cover" }, reply: STILL_WAITING });
            update({ activity: "partnerThinking" });
            break;
          case "nudge":
            if (reading) {
              setPlan({ turn: { kind: "nudge" }, reply: READING });
              update({ activity: "reading", canNext: true });
            }
            break;
          case "redo": {
            const step: Step = { kind: "redo", round: round().n };
            lastQuestion = { step, text: round().question.text };
            setPlan({
              turn: { kind: "cover" },
              startWhenAnswered: "betterVersion",
              reply: THANKS,
            });
            update({ step, activity: "yourTurn" });
            break;
          }
          case "betterVersion":
            startReading();
            break;
          case "transferComment":
            wrapUp();
            break;
        }
        advanceWait();
        break;
      }
      case "learnerTurnStarted":
        learnerTurnOpen = true;
        turnOpenedAt = clock.now();
        if (timeUp) {
          // Whatever was about to be said is dropped by the adapter; the Partner replies to the learner instead.
          speakWhenQuiet = null;
          if (plan) expected = plan.turn;
          planTimeUp();
        } else if (unspoken && unspoken.turn.kind !== "cover") {
          // The learner talked before the Partner started, so the adapter drops that reply. Say it once they're done,
          // and have the Partner only cover whatever they said.
          speakWhenQuiet = unspoken;
          setPlan({ turn: { kind: "cover" }, reply: STILL_WAITING });
        }
        unspoken?.cancelTimer();
        unspoken = null;
        update({ activity: "listening", canDone: true, canNext: false });
        break;
      case "resuming":
        // The adapter re-sends what was queued; don't count the reconnect against a speak() still waiting for its turn.
        unspoken?.cancelTimer();
        activityBeforeResume = view.activity;
        update({ activity: "resuming" });
        break;
      case "resumed":
        if (unspoken) {
          unspoken.cancelTimer();
          armRetry(unspoken);
        }
        if (e.fresh) void briefFreshSession();
        if (view.activity === "resuming") update({ activity: activityBeforeResume });
        break;
      case "connectionLost":
        finish("connectionLost");
        break;
      case "learnerTurnEnded": {
        learnerTurnOpen = false;
        replyPending = true;
        // Response latency: the question ended, then the turn opened, and its audio starts PRE_ROLL_MS before that.
        const startedAfterMs = partnerEndedAt === null ? undefined : turnOpenedAt - PRE_ROLL_MS - partnerEndedAt;
        const turn: AnswerTurn = {
          transcript: transcriber.transcribe(e.audio).catch(() => null), audio: e.audio, speechMs: e.speechMs,
          ...(startedAfterMs !== undefined ? { startedAfterMs } : {}),
        };
        void turn.transcript.then((t) => { if (hasWordTimings(t)) delete turn.audio; });
        // Turns with no Partner reply in between belong to one Answer.
        const last = view.thread.at(-1);
        const continues = last?.kind === "answer";
        answerMs = continues ? answerMs + e.speechMs : e.speechMs;
        const redo = view.step?.kind === "redo";
        const aside = !plan?.startWhenAnswered && (wait !== null || speakWhenQuiet !== null || reading !== null);
        const answers = answersNow();
        if (continues && answers.length) answers.at(-1)!.turns.push(turn);
        else answers.push({ to: lastQuestion ?? { step: view.step!, text: "" }, turns: [turn], redo, aside });
        const line: ThreadItem = { kind: "answer", seconds: Math.round(answerMs / 1000), ...(redo ? { redo } : {}), ...(aside ? { aside } : {}) };
        update({
          thread: continues ? [...view.thread.slice(0, -1), line] : [...view.thread, line],
          activity: "partnerThinking",
          canDone: false,
        });
        if (plan?.startWhenAnswered && !timeUp) startWait(plan.startWhenAnswered);
        break;
      }
    }
  }
  live.subscribe(onLive);

  /** The call so far, for a fresh Live session that has heard none of it. */
  async function callSoFar() {
    const lines = [
      "[Director] The call has moved to a new connection that hasn't heard it so far. Here is what happened, for context only. Don't reply to this message; keep following the [Director] notes.",
    ];
    if (openedWith) lines.push(`You opened with: ${openedWith}`);
    const answered = async (answers: AnswerRecord[]) => {
      for (const a of answers.filter((x) => !x.aside)) {
        lines.push(`You asked: ${a.to.text.trim() || "(the question)"}`);
        lines.push(`The learner ${a.redo ? "did the Redo" : "answered"}: ${(await transcriptOf(a)) || "(not transcribed)"}`);
      }
    };
    for (const r of rounds.filter((x) => x.threadFrom >= 0)) {
      lines.push(`Round ${r.n}. Main question: ${r.question.text}`);
      await answered(r.answers.filter((a) => !a.redo));
      if (r.coachingPoint) lines.push(`You gave this Coaching point: you said "${r.coachingPoint.quote}". ${r.coachingPoint.fix}`);
      await answered(r.answers.filter((a) => a.redo));
    }
    if (transfer && transfer.threadFrom >= 0) {
      lines.push(`Transfer question: ${questions.transfer.text}`);
      await answered(transfer.answers);
    }
    return lines.join("\n");
  }

  /** After a fresh Live session: brief the Partner, then ask again for whatever was pending. */
  async function briefFreshSession() {
    const recap = await callSoFar();
    if (view.step?.kind === "ended") return;
    live.addContext(recap);
    if (unspoken) speak(unspoken.turn, unspoken.instruction, unspoken.retries);
    // The learner finished and the reply never came: ask for it now.
    else if (replyPending && !learnerTurnOpen && !partnerSpeaking && plan) speak(plan.turn, plan.reply.now);
    else if (plan) live.setNextReply(plan.reply.note);
  }

  /** What happened in a Round, read from its stretch of the thread. */
  function roundRecord(r: RoundState, until: number): RoundRecord {
    const items = r.threadFrom < 0 ? [] : view.thread.slice(r.threadFrom, until);
    const answerLines = items.flatMap((t) => (t.kind === "answer" ? [t] : []));
    const redoLine = answerLines.filter((t) => t.redo).at(-1);
    return {
      mainQuestion: r.question.text,
      followUpTypes: items.flatMap((t) => (t.kind === "partner" && t.followUpType && !t.repeat ? [t.followUpType] : [])),
      answerSeconds: answerLines.filter((t) => !t.redo && !t.aside).map((t) => t.seconds),
      ...(r.coachingPoint ? { coachingPoint: r.coachingPoint } : {}),
      ...(redoLine ? { redoSeconds: redoLine.seconds } : {}),
      ...(r.redo ? { redo: r.redo } : {}),
      ...(r.betterVersion ? { betterVersion: r.betterVersion } : {}),
    };
  }

  function finish(reason: EndReason) {
    if (view.step?.kind === "ended") return;
    cancelWait();
    unspoken?.cancelTimer();
    reading?.cancelTimer();
    live.close();
    const startedAt = view.startedAt ?? clock.now();
    const started = startedRounds();
    const transferFrom = transfer && transfer.threadFrom >= 0 ? transfer.threadFrom : view.thread.length;
    const transferLine = view.thread.slice(transferFrom).find((t) => t.kind === "answer" && !t.aside);
    const record: SessionRecord = {
      id: `s-${startedAt}`,
      sceneId: questions.scene.id,
      questionIds: [...askedIds],
      startedAt,
      endedAt: clock.now(),
      endReason: reason,
      rounds: started.map((r, i) => roundRecord(r, started[i + 1]?.threadFrom ?? transferFrom)),
      ...(transfer && transfer.threadFrom >= 0
        ? {
          transfer: {
            question: questions.transfer.text,
            ...(transferLine?.kind === "answer" ? { answerSeconds: transferLine.seconds } : {}),
            ...(transfer.comment ? { comment: transfer.comment } : {}),
          },
        }
        : {}),
      ...(focus.text ? { nextFocus: focus.text } : {}),
      ...(today ? { thinkingPattern: today.pattern.id, ...(introduced ? { patternIntroduced: true } : {}), hintUses } : {}),
    };
    saved = record;
    coming.add("redoAndFocus").add("metrics");
    store.saveSession(record).catch(() => { /* not persisted */ });
    publish();
    update({ step: { kind: "ended", reason }, activity: "ended", canDone: false, canNext: false, hint: null });
    void completeRecord(started);
    void measure(started);
  }

  /** The record as saved, with what came in after the end; and the parts still coming. */
  let saved: SessionRecord | null = null;
  const coming = new Set<"redoAndFocus" | "metrics">();

  function publish() {
    summary = { record: saved!, complete: coming.size === 0 };
    update({});
  }

  /** Adds to the saved record. Only replaces it, so a Session the learner deleted in the meantime stays deleted. */
  function patch(changes: Partial<SessionRecord>) {
    saved = { ...saved!, ...changes };
    store.replaceSession(saved).catch(() => { /* not persisted */ });
  }

  /** Adds what was still on its way when the Session ended: a Redo transcript, the Next focus. */
  async function completeRecord(started: RoundState[]) {
    const nextFocus = requestNextFocus();
    const redos = await Promise.all(started.map(redoOf));
    const rounds = saved!.rounds;
    const withRedos = rounds.map((r, i) => (r.redo || !redos[i] || r.redoSeconds === undefined ? r : { ...r, redo: redos[i] }));
    if (withRedos.some((r, i) => r !== rounds[i])) {
      patch({ rounds: withRedos });
      publish();
    }
    const text = await nextFocus;
    if (text && !saved!.nextFocus) patch({ nextFocus: text });
    coming.delete("redoAndFocus");
    publish();
  }

  /**
   * The speech metrics, from the Answers' timed transcripts (most came in during the call). A turn without one is
   * transcribed again, twice; if one is still missing, the audio is kept in the Store and tried again later.
   */
  async function measure(started: RoundState[]) {
    const pace = { wait: (ms: number) => new Promise<void>((resolve) => clock.after(ms, resolve)) };
    const measured = (kind: Step["kind"]): kind is MeasuredKind => kind === "main" || kind === "followUp" || kind === "transfer";
    const counted = [...started.flatMap((r) => r.answers), ...(transfer?.answers ?? [])].flatMap((a) => {
      const kind = a.to.step.kind;
      return !a.redo && !a.aside && measured(kind) ? [{ ...a, kind }] : [];
    });
    const answers: PendingAnswer[] = await Promise.all(counted.map(async (a) => ({
      kind: a.kind,
      question: a.to.text.trim(),
      turns: await Promise.all(a.turns.map(async (t) => {
        const transcript = await Promise.race([t.transcript, new Promise<null>((resolve) => clock.after(TRANSCRIPT_WAIT_MS, () => resolve(null)))]);
        const at = t.startedAfterMs !== undefined ? { startedAfterMs: t.startedAfterMs } : {};
        return hasWordTimings(transcript) ? { speechMs: t.speechMs, ...at, transcript } : { speechMs: t.speechMs, ...at, audio: t.audio };
      })),
    })));
    if (answers.length) {
      for (let i = 0; i < TRANSCRIBE_RETRIES && !allTranscribed(answers); i++) {
        if (i) await new Promise<void>((resolve) => clock.after(TRANSCRIBE_RETRY_MS, resolve));
        await transcribeMissing(answers, transcriber, pace);
      }
      if (allTranscribed(answers)) patch({ metrics: await measureSession(answers, coach) });
      else {
        // The record first: a retry that finds the audio then also finds the record waiting for it.
        patch({ metricsPending: true });
        await store.savePendingMetrics({ sessionId: saved!.id, answers }).catch(() => { /* not kept */ });
      }
    }
    coming.delete("metrics");
    publish();
  }

  return {
    view: () => view,
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
    async start() {
      update({ activity: "connecting", startedAt: clock.now() });
      const past = store.loadSessions().catch(() => []);
      try {
        await live.connect();
      } catch {
        return finish("connectionLost");
      }
      history = await past;
      if (view.step?.kind === "ended") return;
      clock.after(Math.max(0, timeCapMs - (clock.now() - view.startedAt!)), onTimeCap);
      if (practice) {
        today = todaysPattern(history);
        update({ pattern: { pattern: today.pattern, introducing: today.introduce } });
      }
      const nextFocus = lastNextFocus(history);
      if (nextFocus || today?.introduce) {
        openedWith = openingLine(nextFocus, today?.introduce ? today.pattern.intro : null);
        const card: ThreadItem[] = today?.introduce ? [{ kind: "pattern", pattern: today.pattern }] : [];
        update({ step: { kind: "opening" }, activity: "partnerThinking", thread: [...view.thread, ...card] });
        return speak({ kind: "opening" }, sayExactly(openedWith));
      }
      const step: Step = { kind: "main", round: 1 };
      update({ step, activity: "partnerThinking" });
      speak({ kind: "question", step }, `[Director] Greet the learner in one short sentence, then ask this Main question word for word: "${round().question.text}"`);
    },
    done() {
      if (view.canDone) live.endLearnerTurn();
    },
    next() {
      next();
    },
    hint() {
      if (!today || view.step?.kind === "ended") return;
      if (view.hint) return update({ hint: null });
      // The phrases that open today's pattern first, then the others, in turn.
      const phrases = practice!.holdingPhrases;
      const ordered = [...phrases.filter((p) => p.fits === today!.pattern.id), ...phrases.filter((p) => p.fits !== today!.pattern.id)];
      const phrase: HoldingPhrase | null = ordered[hintUses % ordered.length] ?? null;
      hintUses++;
      update({ hint: { pattern: today.pattern, phrase } });
    },
    end() {
      finish("userEnded");
    },
    summary: () => summary,
  };
}
