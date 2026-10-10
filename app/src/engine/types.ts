import type { HoldingPhrase, ThinkingPattern, ThinkingPatternId } from "../content/practice";
import type { SessionQuestions } from "../content/scene";

export type FollowUpType = "why" | "soWhat" | "counterexample" | "changeYourMind" | "beSpecific" | "haveYouConsidered" | "hostileFraming";

export type EndReason = "complete" | "userEnded" | "timeCap" | "connectionLost";
/** How a learner turn closed: a stretch of quiet, or the Done button. */
export type TurnEndedBy = "silence" | "done";

export type RoundNumber = 1 | 2;

export type Step =
  /**
   * The Partner reminds the learner of the last Session's Next focus and, in the first few Sessions, introduces today's
   * Thinking pattern. Skipped when there is neither.
   */
  | { kind: "opening" }
  | { kind: "main"; round: RoundNumber }
  | { kind: "followUp"; round: RoundNumber; n: number; type: FollowUpType }
  /** The Coach brain is choosing the Coaching point (the Partner covers the wait), then the Partner speaks it. */
  | { kind: "coaching"; round: RoundNumber }
  | { kind: "redo"; round: RoundNumber }
  /** Shown as text; the Partner says one line pointing to it, and the learner reads it until they tap Next. */
  | { kind: "betterVersion"; round: RoundNumber }
  /** Asked after Round 2; gets a one-line comment from the Coach brain and no Redo. */
  | { kind: "transfer" }
  | { kind: "wrapUp" }
  | { kind: "ended"; reason: EndReason };

/** What the call screen shows. The learner's words never appear here; an Answer is only its length. */
export interface CallView {
  step: Step | null;
  /** reading: the learner reads the Better version and taps Next to go on. */
  activity: "idle" | "connecting" | "partnerSpeaking" | "partnerThinking" | "yourTurn" | "listening" | "reading" | "resuming" | "ended";
  thread: ThreadItem[];
  /** Done is only useful while the learner's turn is open. */
  canDone: boolean;
  /** Next moves on from the Better version to the next Round or the Transfer question. */
  canNext: boolean;
  startedAt: number | null;
  /** Today's Thinking pattern. introducing: still in the introduction period, so the reference panel may show it. */
  pattern: { pattern: ThinkingPattern; introducing: boolean } | null;
  /** The Structure hint, while the learner has it open. Shown silently: the Partner is never told. */
  hint: { pattern: ThinkingPattern; phrase: HoldingPhrase | null } | null;
}

export type ThreadItem =
  /**
   * step "covering": a short line covering a wait for the Coach brain. "redo": the Main question asked again for the Redo.
   * "nudge": a short line while the learner reads the Better version. repeat: the Partner said its previous question
   * again because the learner asked.
   */
  | { kind: "partner"; step: "opening" | "main" | "followUp" | "covering" | "redo" | "transfer" | "nudge" | "wrapUp"; followUpType?: FollowUpType; text: string; repeat?: boolean }
  /** aside: said while the Partner covered a wait for the Coach brain; not one of the Round's Answers. */
  | { kind: "answer"; seconds: number; redo?: boolean; aside?: boolean }
  /** Quotes the learner's words: allowed on screen, unlike their Answers. */
  | { kind: "coaching"; point: CoachingPoint; redoQuestion: string }
  | { kind: "betterVersion"; text: string }
  /** Today's Thinking pattern with its skeleton and an example, shown while the Partner introduces it. */
  | { kind: "pattern"; pattern: ThinkingPattern }
  /** The Coach brain's one-line comment on the Transfer Answer, spoken word for word by the Partner. */
  | { kind: "transferComment"; text: string };

export type LiveEvent =
  | { type: "partnerTurnStarted" }
  /** Incremental transcription of what the Partner is saying. */
  | { type: "partnerText"; text: string }
  /**
   * The Partner's audio has finished playing, or the learner cut in. cut: the rest of the turn was lost in a reconnect.
   * sinceAudioEndedMs: the audio finished this long before the event (the turn only ends once the server says it's
   * complete, which can come after the last sound).
   */
  | { type: "partnerTurnEnded"; interrupted: boolean; cut?: boolean; sinceAudioEndedMs?: number }
  | { type: "learnerTurnStarted" }
  /** speechMs excludes the trailing silence that closed the turn. audio is everything sent for the turn. */
  | { type: "learnerTurnEnded"; speechMs: number; by: TurnEndedBy; audio: AnswerAudio }
  | { type: "resuming" }
  /**
   * fresh: a new Live session rather than the same one resumed. The Partner remembers nothing of the call, and nothing
   * that was waiting to be sent has been sent: the engine briefs it and asks again for whatever was pending.
   */
  | { type: "resumed"; fresh?: boolean }
  /** Resumption gave up. */
  | { type: "connectionLost" };

/** The live voice call. Owns the audio path, turn detection and connection swaps. */
export interface LiveAdapter {
  connect(): Promise<void>;
  /** The Partner speaks now, following this instruction. */
  speak(instruction: string): void;
  /** Standing instruction for the Partner's next reply, which comes when the learner's turn ends. */
  setNextReply(instruction: string): void;
  /** Ends the learner's turn now (Done). */
  endLearnerTurn(): void;
  /**
   * true while the engine is about to have the Partner speak (it is waiting on the Coach brain, or for a quiet moment
   * to speak). The adapter then holds a proactive connection swap, which would add its gap to the wait. A forced swap
   * still happens on time.
   */
  holdSwap(hold: boolean): void;
  /** Context for the Partner to read without replying (after a fresh session, the call so far). */
  addContext(text: string): void;
  close(): void;
  subscribe(listener: (e: LiveEvent) => void): () => void;
}

export interface Clock {
  now(): number;
  /** Runs fn once after ms; returns a cancel function. */
  after(ms: number, fn: () => void): () => void;
}

/**
 * 16 kHz mono 16-bit PCM, as sent to the Live API. It starts PRE_ROLL_MS before the learner's turn opened: the turn
 * opens once the mic has been loud for a few frames, and the audio just before that is sent too.
 */
export type AnswerAudio = ArrayBuffer;
export const PRE_ROLL_MS = 320;

export interface Transcript {
  /** Verbatim, fillers included. */
  text: string;
  /** Times from the start of the Answer's audio. */
  words: { text: string; startMs: number; endMs: number }[];
  /**
   * The fallback model transcribed it: the words with their fillers, but no word timings. Good enough for the Coach
   * brain during the call; the metrics need it transcribed again.
   */
  untimed?: boolean;
}

export interface TranscriberAdapter {
  transcribe(audio: AnswerAudio): Promise<Transcript>;
}

export type RubricDimension = "directness" | "structure" | "reasoning";

export interface CoachingPoint {
  dimension: RubricDimension;
  /** The learner's own words, verbatim from the transcript. */
  quote: string;
  /** What to do differently, spoken by the Partner right after the quote. */
  fix: string;
}

/** One question of the Round and the learner's verbatim Answer to it. */
export interface Exchange {
  question: string;
  followUpType?: FollowUpType;
  answer: string;
}

export interface CoachAdapter {
  coachingPoint(input: { mainQuestion: string; exchanges: Exchange[] }): Promise<CoachingPoint>;
  /** The Redo rewritten: the learner's position and wording, tightened. */
  betterVersion(input: { mainQuestion: string; exchanges: Exchange[]; coachingPoint: CoachingPoint; redo: string }): Promise<string>;
  /**
   * One spoken sentence on the Transfer Answer: did this Session's Coaching points carry over? Says what to change,
   * never a wording to use; anything it quotes is the learner's own words.
   */
  transferComment(input: { question: string; answer: string; coachingPoints: CoachingPoint[] }): Promise<string>;
  /**
   * One line for the next Session to work on, from this Session's Coaching points, Redos and Transfer Answer. Same
   * rules: what to change, never a wording to use.
   */
  nextFocus(input: NextFocusInput): Promise<string>;
  /**
   * For each Answer, in order: is its first sentence of substance the Answer step of the course's skeleton (their call,
   * stated plainly; a one-sentence Paraphrase before it is fine)? A metric on the summary, asked for after the Session.
   */
  answerFirst(input: { answers: { question: string; answer: string }[] }): Promise<boolean[]>;
}

export interface NextFocusInput {
  rounds: { mainQuestion: string; coachingPoint?: CoachingPoint; redo?: string }[];
  transfer?: { question: string; answer: string };
}

export interface SessionRecord {
  id: string;
  sceneId: string;
  /** The Question bank entries the Partner asked, in order. Records from before the bank (ticket 06) have none. */
  questionIds?: string[];
  startedAt: number;
  endedAt: number;
  endReason: EndReason;
  rounds: RoundRecord[];
  transfer?: TransferRecord;
  /** For the next Session: shown on the Ready screen and said by the Partner when it opens. */
  nextFocus?: string;
  /** Today's Thinking pattern. */
  thinkingPattern?: ThinkingPatternId;
  /** The Partner introduced the pattern in its opening (the first few Sessions). */
  patternIntroduced?: boolean;
  /** Times the learner opened the Structure hint. */
  hintUses?: number;
  /** Measured after the Session from the verbatim transcripts; absent until then, and on records from before ticket 08. */
  metrics?: SessionMetrics;
  /** Some Answers couldn't be transcribed with word timings yet: their audio is kept, and transcribing is tried again later. */
  metricsPending?: boolean;
  /** Transcribing was tried again too many times without success: the audio is gone and the Session has no metrics. */
  metricsUnavailable?: boolean;
}

/** Which Answers the metrics count: those to the Main questions, the Follow-ups and the Transfer question, not Redos. */
export type MeasuredKind = "main" | "followUp" | "transfer";

export interface AnswerMetrics {
  kind: MeasuredKind;
  /**
   * From the end of the Partner's question to the first word of substance (a Holding phrase counts; fillers don't).
   * None when the learner cut in on the question, or said nothing but fillers.
   */
  latencyMs?: number;
  fillers: number;
  speechMs: number;
  holdingPhrases: number;
  /** The Coach brain's judgement; none if it failed or there were no words. */
  answerFirst?: boolean;
}

export interface SessionMetrics {
  /** In the order they were given. */
  answers: AnswerMetrics[];
  /** Median over the Answers that have one. */
  responseLatencyMs?: number;
  /** Fillers per minute of the learner's speech, over all the Answers. */
  fillersPerMinute: number;
  /** Mean length of an Answer, in seconds. */
  answerSeconds: number;
  /** How many Answers had the Answer in their first sentence of substance, out of those judged. */
  answerFirst?: { yes: number; of: number };
  holdingPhrases: number;
}

/** A Session's Answers kept for measuring later, because some couldn't be transcribed with word timings yet. */
export interface PendingMetrics {
  sessionId: string;
  /** App opens that tried again and still left Answers untranscribed. */
  tries?: number;
  answers: PendingAnswer[];
}

export interface PendingAnswer {
  kind: MeasuredKind;
  /** The question it answered, for the Coach brain's judgement. */
  question: string;
  /**
   * An Answer can span several learner turns. Audio is kept only until its turn has a timed transcript. startedAfterMs:
   * the turn's audio starts this long after the Partner's question ended (turn open − PRE_ROLL_MS − question end); none
   * when the learner cut in on the question.
   */
  turns: { speechMs: number; startedAfterMs?: number; audio?: AnswerAudio; transcript?: Transcript }[];
}

export interface TransferRecord {
  question: string;
  answerSeconds?: number;
  comment?: string;
}

export interface RoundRecord {
  mainQuestion: string;
  followUpTypes: FollowUpType[];
  /** The Answers to the Main question and Follow-ups; the Redo is kept apart. */
  answerSeconds: number[];
  coachingPoint?: CoachingPoint;
  redoSeconds?: number;
  /** The Redo's verbatim transcript, shown next to the Better version in the summary. */
  redo?: string;
  betterVersion?: string;
}

/** The learner's marks on the Question bank. */
export interface QuestionMarks {
  /** Asked by the Partner in some Session; never chosen again. */
  seen: string[];
  /** Struck out by the learner in the review screen; never chosen. */
  struck: string[];
}

/** Sessions and the Question bank marks, saved on the device. */
export interface Store {
  /** Oldest first. */
  loadSessions(): Promise<SessionRecord[]>;
  /** Saves the record, replacing any saved one with the same id. */
  saveSession(record: SessionRecord): Promise<void>;
  /** Replaces a saved record; does nothing if it is no longer there (the learner deleted it). */
  replaceSession(record: SessionRecord): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteAllSessions(): Promise<void>;
  loadQuestionMarks(): Promise<QuestionMarks>;
  markSeen(questionId: string): Promise<void>;
  setStruck(questionId: string, struck: boolean): Promise<void>;
  /** Answer audio waiting for a transcription retry. Deleting a Session deletes its pending audio too. */
  loadPendingMetrics(): Promise<PendingMetrics[]>;
  savePendingMetrics(pending: PendingMetrics): Promise<void>;
  deletePendingMetrics(sessionId: string): Promise<void>;
}

/**
 * What the Session saved. complete is false while a part of it (the Next focus, a Redo transcript, the metrics) is still
 * coming.
 */
export interface SessionSummary {
  record: SessionRecord;
  complete: boolean;
}

export interface SessionDeps {
  live: LiveAdapter;
  clock: Clock;
  store: Store;
  coach: CoachAdapter;
  transcriber: TranscriberAdapter;
  /** The Scene and its three questions, chosen with chooseQuestions(). */
  questions: SessionQuestions;
  /** Test-only (?soak=1): keep asking Follow-ups until End, for 10–12 min call-stability tests. */
  keepGoing?: boolean;
  /** When the Partner is told to wrap up. Default 12 min; shorter only in tests (?timeCap=). */
  timeCapMs?: number;
  /**
   * The learner's Holding phrases, picked at onboarding. With them the Session has a Thinking pattern of the day and a
   * Hint; the app always passes them (it doesn't start a call before onboarding), tests only where they matter.
   */
  practice?: { holdingPhrases: HoldingPhrase[] };
}

export interface Session {
  view(): CallView;
  subscribe(listener: (view: CallView) => void): () => void;
  start(): Promise<void>;
  done(): void;
  /** Moves on from the Better version. */
  next(): void;
  /** Opens or closes the Structure hint. Each opening is counted; the Partner isn't told. */
  hint(): void;
  end(): void;
  /** Set once the Session has ended; subscribers are told when it changes. */
  summary(): SessionSummary | null;
}
