import { describe, expect, it } from "vitest";
import { chooseQuestions, createSession, stillUnused } from "./session";
import { MAX_RETRY_OPENS, RETRY_GAP_MS, headlineInsight, insight, retryPendingMetrics, trend, type Pace } from "./metrics";
import type {
  CoachAdapter, CoachingPoint, Exchange, LiveAdapter, LiveEvent, NextFocusInput, PendingMetrics, QuestionMarks, SessionRecord, Store, TranscriberAdapter,
  Transcript, TurnEndedBy,
} from "./types";
import { QUESTIONS, SCENES } from "../content/bank";
import type { BankQuestion, Category, Scene, SessionQuestions } from "../content/scene";
import { HOLDING_PHRASES, THINKING_PATTERNS, type HoldingPhrase } from "../content/practice";

// The Corner Café's first three bank questions: the ones the fake mic's clips answer.
const cafeQuestion = (n: number) => QUESTIONS.find((q) => q.id === `01-corner-cafe/${n}`)!;
const PLAN: SessionQuestions = { scene: SCENES.find((s) => s.id === "01-corner-cafe")!, rounds: [cafeQuestion(1), cafeQuestion(2)], transfer: cafeQuestion(3) };
const Q1 = PLAN.rounds[0].text;
const Q2 = PLAN.rounds[1].text;
const Q3 = PLAN.transfer.text;

type Command =
  | { cmd: "connect" }
  | { cmd: "speak"; text: string }
  | { cmd: "setNextReply"; text: string }
  | { cmd: "endLearnerTurn" }
  | { cmd: "holdSwap"; hold: boolean }
  | { cmd: "addContext"; text: string }
  | { cmd: "close" };

function fakeLive() {
  const commands: Command[] = [];
  const listeners = new Set<(e: LiveEvent) => void>();
  const live: LiveAdapter = {
    async connect() { commands.push({ cmd: "connect" }); },
    speak(text) { commands.push({ cmd: "speak", text }); },
    setNextReply(text) { commands.push({ cmd: "setNextReply", text }); },
    endLearnerTurn() { commands.push({ cmd: "endLearnerTurn" }); },
    holdSwap(hold) { commands.push({ cmd: "holdSwap", hold }); },
    addContext(text) { commands.push({ cmd: "addContext", text }); },
    close() { commands.push({ cmd: "close" }); },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
  const emit = (e: LiveEvent) => listeners.forEach((l) => l(e));
  return {
    live,
    commands,
    emit,
    /** Everything the Partner was told to say now. */
    speaks: () => commands.flatMap((c) => (c.cmd === "speak" ? [c.text] : [])),
    /** The latest command, ignoring swap holds. */
    lastCommand: () => commands.filter((c) => c.cmd !== "holdSwap").at(-1),
    /** The latest instruction for the Partner's next reply. */
    nextReply: () => commands.filter((c) => c.cmd === "setNextReply").at(-1) as { text: string } | undefined,
    /** The Partner says something, and its audio finishes. */
    partnerSays(text: string) {
      emit({ type: "partnerTurnStarted" });
      emit({ type: "partnerText", text });
      emit({ type: "partnerTurnEnded", interrupted: false });
    },
    /** The learner answers for `seconds`, saying `says`, then the turn closes. */
    learnerAnswers(seconds: number, by: TurnEndedBy = "silence", says = `answer of ${seconds} s`) {
      emit({ type: "learnerTurnStarted" });
      emit({ type: "learnerTurnEnded", speechMs: seconds * 1000, by, audio: audioOf(says) });
    },
  };
}

function fakeClock(start = 1_000_000) {
  let t = start;
  let timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    after(ms: number, fn: () => void) {
      const timer = { at: t + ms, fn };
      timers.push(timer);
      return () => { timers = timers.filter((x) => x !== timer); };
    },
    advance(ms: number) {
      t += ms;
      const due = timers.filter((x) => x.at <= t);
      timers = timers.filter((x) => x.at > t);
      due.forEach((x) => x.fn());
    },
  };
}

// The fake "audio" of an Answer is just its words, which the fake transcriber reads back.
const audioOf = (says: string) => new TextEncoder().encode(says).buffer as ArrayBuffer;

/** Word timings for a transcript: each word 300 ms, the first `startMs` into the audio. */
const timedWords = (text: string, startMs = 500) =>
  text.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, startMs: startMs + i * 300, endMs: startMs + i * 300 + 300 }));

/**
 * Reads back what the "audio" says, with word timings. canned: a transcript for a given Answer, as the transcriber
 * would return it. untimed: the fallback model's answer, without word timings. calls: every transcription asked for.
 */
function fakeTranscriber() {
  const t = {
    fail: false,
    untimed: false,
    calls: [] as string[],
    canned: new Map<string, Transcript>(),
    async transcribe(audio: ArrayBuffer): Promise<Transcript> {
      const text = new TextDecoder().decode(audio);
      t.calls.push(text);
      if (t.fail) throw new Error("transcription failed");
      if (t.untimed) return { text, words: [], untimed: true };
      return t.canned.get(text) ?? { text, words: timedWords(text) };
    },
  };
  return t satisfies TranscriberAdapter;
}

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A Coach brain whose answers the test hands back when it chooses. */
function fakeCoach() {
  const pointCalls: { input: { mainQuestion: string; exchanges: Exchange[] }; reply: ReturnType<typeof deferred<CoachingPoint>> }[] = [];
  const betterCalls: { input: Parameters<CoachAdapter["betterVersion"]>[0]; reply: ReturnType<typeof deferred<string>> }[] = [];
  const transferCalls: { input: Parameters<CoachAdapter["transferComment"]>[0]; reply: ReturnType<typeof deferred<string>> }[] = [];
  const focusCalls: { input: NextFocusInput; reply: ReturnType<typeof deferred<string>> }[] = [];
  const answerFirstCalls: Parameters<CoachAdapter["answerFirst"]>[0][] = [];
  /** The Coach brain's verdicts on the first sentences: by default, every Answer opens with its Answer. */
  const judge = { answerFirst: (input: Parameters<CoachAdapter["answerFirst"]>[0]): Promise<boolean[]> => Promise.resolve(input.answers.map(() => true)) };
  const coach: CoachAdapter = {
    coachingPoint(input) {
      const reply = deferred<CoachingPoint>();
      pointCalls.push({ input, reply });
      return reply.promise;
    },
    betterVersion(input) {
      const reply = deferred<string>();
      betterCalls.push({ input, reply });
      return reply.promise;
    },
    transferComment(input) {
      const reply = deferred<string>();
      transferCalls.push({ input, reply });
      return reply.promise;
    },
    nextFocus(input) {
      const reply = deferred<string>();
      focusCalls.push({ input, reply });
      return reply.promise;
    },
    answerFirst(input) {
      answerFirstCalls.push(input);
      return judge.answerFirst(input);
    },
  };
  return { coach, pointCalls, betterCalls, transferCalls, focusCalls, answerFirstCalls, judge };
}

/** Lets resolved adapter promises run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function memoryStore(initial: SessionRecord[] = []): Store & { sessions: SessionRecord[]; marks: QuestionMarks; pending: PendingMetrics[] } {
  const store = {
    sessions: [...initial],
    pending: [] as PendingMetrics[],
    loadPendingMetrics: async () => structuredClone(store.pending),
    async savePendingMetrics(p: PendingMetrics) {
      store.pending = [...store.pending.filter((x) => x.sessionId !== p.sessionId), structuredClone(p)];
    },
    async deletePendingMetrics(id: string) { store.pending = store.pending.filter((x) => x.sessionId !== id); },
    marks: { seen: [], struck: [] } as QuestionMarks,
    loadQuestionMarks: async () => ({ seen: [...store.marks.seen], struck: [...store.marks.struck] }),
    async markSeen(id: string) { if (!store.marks.seen.includes(id)) store.marks.seen.push(id); },
    async setStruck(id: string, struck: boolean) {
      store.marks.struck = store.marks.struck.filter((x) => x !== id).concat(struck ? [id] : []);
    },
    loadSessions: async () => [...store.sessions].sort((a, b) => a.startedAt - b.startedAt),
    async saveSession(r: SessionRecord) {
      const i = store.sessions.findIndex((x) => x.id === r.id);
      if (i < 0) store.sessions.push(r);
      else store.sessions[i] = r;
    },
    async replaceSession(r: SessionRecord) {
      const i = store.sessions.findIndex((x) => x.id === r.id);
      if (i >= 0) store.sessions[i] = r;
    },
    async deleteSession(id: string) {
      store.sessions = store.sessions.filter((x) => x.id !== id);
      store.pending = store.pending.filter((x) => x.sessionId !== id);
    },
    async deleteAllSessions() { store.sessions = []; store.pending = []; },
  };
  return store;
}

async function startedSession(opts: { store?: ReturnType<typeof memoryStore>; timeCapMs?: number; holdingPhrases?: HoldingPhrase[]; startAt?: number } = {}) {
  const f = fakeLive();
  const clock = fakeClock(opts.startAt);
  const store = opts.store ?? memoryStore();
  const transcriber = fakeTranscriber();
  const c = fakeCoach();
  const session = createSession({
    live: f.live, clock, store, questions: PLAN, coach: c.coach, transcriber, timeCapMs: opts.timeCapMs,
    ...(opts.holdingPhrases ? { practice: { holdingPhrases: opts.holdingPhrases } } : {}),
  });
  await session.start();
  return { ...f, ...c, clock, store, transcriber, session };
}

describe("Session — one Round", () => {
  it("connects and tells the Partner to ask the Round's Main question", async () => {
    const { commands, session } = await startedSession();

    expect(commands[0]).toEqual({ cmd: "connect" });
    const speak = commands.find((c) => c.cmd === "speak");
    expect(speak && "text" in speak && speak.text).toContain(Q1);
    expect(session.view().step).toEqual({ kind: "main", round: 1 });
  });

  it("shows the Main question as a Partner bubble, then asks a Follow-up of a type the engine picked", async () => {
    const f = await startedSession();

    f.partnerSays("Morning. Laptops banned on weekends, 9 to 2 — good idea or not?");
    expect(f.session.view().thread).toEqual([
      { kind: "partner", step: "main", text: "Morning. Laptops banned on weekends, 9 to 2 — good idea or not?" },
    ]);
    expect(f.nextReply()?.text).toMatch(/Follow-up of type "Why"/);

    f.learnerAnswers(30);
    f.partnerSays("What's the single strongest reason?");
    expect(f.session.view().step).toEqual({ kind: "followUp", round: 1, n: 1, type: "why" });
    expect(f.session.view().thread.at(-1)).toEqual({
      kind: "partner", step: "followUp", followUpType: "why", text: "What's the single strongest reason?",
    });
  });

  it("tells the Partner to build each Follow-up on the learner's Answer, with no ready-made line to read out", async () => {
    const f = await startedSession();

    f.partnerSays(Q1);
    for (const label of ["Why", "So what", "Counterexample"]) {
      const note = f.nextReply()!.text;
      expect(note).toContain(`Follow-up of type "${label}"`);
      expect(note).toMatch(/one specific thing they just said/);
      expect(note).toMatch(/Never ask a generic question/);
      // A hedged Answer is pressed for a call, never taken as backing a side.
      expect(note).toMatch(/made no call/);
      expect(note).toMatch(/never assume a side they didn't take/);
      f.clock.advance(20_000);
      f.learnerAnswers(15);
      f.partnerSays("Follow-up?");
    }
  });

  it("shows each Answer only as its length", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");

    f.learnerAnswers(41.6);

    expect(f.session.view().thread.at(-1)).toEqual({ kind: "answer", seconds: 42 });
  });

  it("counts an Answer split by a long pause as one Answer, without skipping a Follow-up", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");

    f.learnerAnswers(20);
    f.learnerAnswers(10); // the learner went on before the Partner replied
    f.partnerSays("Why?");

    const thread = f.session.view().thread;
    expect(thread.filter((t) => t.kind === "answer")).toEqual([{ kind: "answer", seconds: 30 }]);
    expect(f.session.view().step).toMatchObject({ kind: "followUp", n: 1 });
  });

  it("runs Main question → 3 Follow-ups of different types → Coaching point when the Round moves quickly", async () => {
    const f = await startedSession();
    const steps: unknown[] = [];

    f.partnerSays("Good idea or not?");
    steps.push(f.session.view().step);
    for (let i = 0; i < 4; i++) {
      f.clock.advance(30_000);
      f.learnerAnswers(25);
      f.partnerSays(i < 3 ? "Follow-up?" : "Let me think about that.");
      steps.push(f.session.view().step);
    }

    expect(steps).toEqual([
      { kind: "main", round: 1 },
      { kind: "followUp", round: 1, n: 1, type: "why" },
      { kind: "followUp", round: 1, n: 2, type: "soWhat" },
      { kind: "followUp", round: 1, n: 3, type: "counterexample" },
      { kind: "coaching", round: 1 },
    ]);
    expect(f.session.view().thread.filter((t) => t.kind === "partner").map((t) => t.kind === "partner" && t.step))
      .toEqual(["main", "followUp", "followUp", "followUp", "covering"]);
  });

  it("stops at 2 Follow-ups when the Round has run long", async () => {
    const f = await startedSession();

    f.partnerSays("Good idea or not?");
    for (let i = 0; i < 2; i++) {
      f.clock.advance(90_000);
      f.learnerAnswers(85);
      f.partnerSays("Follow-up?");
    }

    expect(f.session.view().step).toMatchObject({ kind: "followUp", n: 2 });
    expect(f.nextReply()?.text).toMatch(/let me think about that/);
  });

  it("treats the Partner repeating its question as the same Follow-up, not the next one", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(20);
    f.partnerSays("Okay, so if she does that, what actually changes for the business revenue?");
    const noteForNextReply = f.nextReply()?.text;

    f.learnerAnswers(2); // "Could you repeat the question?"
    f.partnerSays("Sure. Okay, so if she does that, what actually changes for the business revenue?");

    expect(f.session.view().step).toEqual({ kind: "followUp", round: 1, n: 1, type: "why" });
    expect(f.session.view().thread.at(-1)).toMatchObject({ kind: "partner", followUpType: "why", repeat: true });
    expect(f.nextReply()?.text).toBe(noteForNextReply);

    f.learnerAnswers(15);
    f.partnerSays("And what does that cost her?");
    expect(f.session.view().step).toMatchObject({ kind: "followUp", n: 2, type: "soWhat" });
    f.session.end();
    expect(store.sessions[0].rounds[0].followUpTypes).toEqual(["why", "soWhat"]);
  });

  it("doesn't mistake a new Follow-up that reuses some of the last question's words for a repeat", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(20);
    f.partnerSays("What's the single strongest reason behind banning laptops at the window tables?");

    f.learnerAnswers(10);
    f.partnerSays("So what actually changes for the café if the window tables turn over faster?");

    expect(f.session.view().step).toMatchObject({ kind: "followUp", n: 2, type: "soWhat" });
    expect(f.session.view().thread.at(-1)).not.toHaveProperty("repeat");
  });

  it("never wraps up with fewer than 2 Follow-ups, however long the Round has run", async () => {
    const f = await startedSession();

    f.partnerSays("Good idea or not?");
    f.clock.advance(400_000);
    f.learnerAnswers(390);
    f.partnerSays("Why?");

    expect(f.session.view().step).toMatchObject({ kind: "followUp", n: 1 });
    expect(f.nextReply()?.text).toMatch(/Follow-up of type/);
  });

  it("prefers the Follow-up types the learner has faced least in past Sessions", async () => {
    const past: SessionRecord = {
      id: "past", sceneId: "01-corner-cafe", startedAt: 0, endedAt: 1, endReason: "complete",
      rounds: [
        { mainQuestion: "q1", followUpTypes: ["why", "soWhat", "counterexample"], answerSeconds: [] },
        { mainQuestion: "q2", followUpTypes: ["why", "soWhat", "beSpecific"], answerSeconds: [] },
      ],
    };
    const f = await startedSession({ store: memoryStore([past]) });

    f.partnerSays("Good idea or not?");
    const types: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      f.learnerAnswers(20);
      f.partnerSays("Follow-up?");
      const step = f.session.view().step;
      types.push(step?.kind === "followUp" && step.type);
    }

    expect(types).toEqual(["changeYourMind", "haveYouConsidered", "hostileFraming"]);
  });
});

describe("Session — soak test mode", () => {
  it("keeps asking Follow-ups until End, cycling through every type, for long-call tests", async () => {
    const f = fakeLive();
    const clock = fakeClock();
    const session = createSession({ live: f.live, clock, store: memoryStore(), questions: PLAN, coach: fakeCoach().coach, transcriber: fakeTranscriber(), keepGoing: true });
    await session.start();

    f.partnerSays("Good idea or not?");
    const types: unknown[] = [];
    for (let i = 0; i < 7; i++) {
      clock.advance(90_000);
      f.learnerAnswers(60);
      f.partnerSays("Follow-up?");
      const step = session.view().step;
      types.push(step?.kind === "followUp" && step.type);
    }

    expect(types).toEqual(["why", "soWhat", "counterexample", "changeYourMind", "beSpecific", "haveYouConsidered", "hostileFraming"]);
    expect(f.nextReply()?.text).not.toMatch(/close the call/);
  });

  it("describes Have you considered…? as an uncovered risk and Hostile framing as a polite attack on their point", async () => {
    const f = fakeLive();
    const clock = fakeClock();
    const session = createSession({ live: f.live, clock, store: memoryStore(), questions: PLAN, coach: fakeCoach().coach, transcriber: fakeTranscriber(), keepGoing: true });
    await session.start();

    f.partnerSays("Good idea or not?");
    const notes: string[] = [];
    for (let i = 0; i < 7; i++) {
      clock.advance(90_000);
      f.learnerAnswers(60);
      f.partnerSays("Follow-up?");
      notes.push(f.nextReply()?.text ?? "");
    }

    const risk = notes.find((n) => n.includes('"Have you considered…?"'))!;
    expect(risk).toMatch(/raise one risk their answer didn't cover/);
    expect(risk).toMatch(/reassurance/);
    const hostile = notes.find((n) => n.includes('"Hostile framing"'))!;
    expect(hostile).toMatch(/restate their point back as a blunt attack/);
    expect(hostile).toMatch(/no insults/);
    expect(hostile).toMatch(/don't agree/);
  });
});

describe("Session — Done and End", () => {
  it("Done ends the learner's turn immediately", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    expect(f.session.view().canDone).toBe(false);

    f.emit({ type: "learnerTurnStarted" });
    expect(f.session.view()).toMatchObject({ activity: "listening", canDone: true });
    f.session.done();

    expect(f.lastCommand()).toEqual({ cmd: "endLearnerTurn" });
    f.emit({ type: "learnerTurnEnded", speechMs: 12_000, by: "done", audio: audioOf("my answer") });
    expect(f.session.view()).toMatchObject({ activity: "partnerThinking", canDone: false });
  });

  it("End stops the call at any point and saves what happened so far", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(30);
    f.partnerSays("Why?");
    f.clock.advance(60_000);

    f.session.end();

    expect(f.lastCommand()).toEqual({ cmd: "close" });
    expect(f.session.view()).toMatchObject({ step: { kind: "ended", reason: "userEnded" }, activity: "ended" });
    expect(store.sessions).toEqual([
      expect.objectContaining({
        sceneId: "01-corner-cafe",
        endReason: "userEnded",
        endedAt: f.clock.now(),
        rounds: [{ mainQuestion: Q1, followUpTypes: ["why"], answerSeconds: [30] }],
      }),
    ]);
  });

  it("has saved the Session by the time the view shows it ended", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    let savedWhenEnded: number | undefined;
    f.session.subscribe((v) => { if (v.step?.kind === "ended") savedWhenEnded = store.sessions.length; });

    f.session.end();

    expect(savedWhenEnded).toBe(1);
  });
});

describe("Session — connection", () => {
  it("carries on at the same step after the Live connection resumes", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(30);
    f.partnerSays("Why?");

    f.emit({ type: "resuming" });
    expect(f.session.view().activity).toBe("resuming");
    f.emit({ type: "resumed" });

    expect(f.session.view()).toMatchObject({ activity: "yourTurn", step: { kind: "followUp", n: 1 } });
    f.learnerAnswers(15);
    f.partnerSays("So what?");
    expect(f.session.view().step).toMatchObject({ kind: "followUp", n: 2, type: "soWhat" });
  });

  it("ends the Session when the connection can't be resumed", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.partnerSays("Good idea or not?");

    f.emit({ type: "connectionLost" });

    expect(f.session.view().step).toEqual({ kind: "ended", reason: "connectionLost" });
    expect(store.sessions[0].endReason).toBe("connectionLost");
  });

  it("ends the Session when the first connection fails", async () => {
    const f = fakeLive();
    f.live.connect = async () => { throw new Error("token mint failed"); };
    const session = createSession({ live: f.live, clock: fakeClock(), store: memoryStore(), questions: PLAN, coach: fakeCoach().coach, transcriber: fakeTranscriber() });

    await session.start();

    expect(session.view().step).toEqual({ kind: "ended", reason: "connectionLost" });
    expect(f.commands.some((c) => c.cmd === "speak")).toBe(false);
  });

  it("doesn't start the Round if End was tapped while connecting", async () => {
    const f = fakeLive();
    let connected!: () => void;
    f.live.connect = () => new Promise<void>((r) => (connected = r));
    const session = createSession({ live: f.live, clock: fakeClock(), store: memoryStore(), questions: PLAN, coach: fakeCoach().coach, transcriber: fakeTranscriber() });

    const starting = session.start();
    session.end();
    connected();
    await starting;

    expect(session.view().step).toEqual({ kind: "ended", reason: "userEnded" });
    expect(f.commands.some((c) => c.cmd === "speak")).toBe(false);
  });

  it("ignores Live events that arrive after the Session ended", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.session.end();

    f.partnerSays("Hello? Are you still there?");

    expect(f.session.view().thread).toHaveLength(1);
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "userEnded" });
  });
});

const POINT: CoachingPoint = {
  dimension: "directness",
  quote: "Um, I think it's a good idea, but only partly.",
  fix: "Lead with your call in the first sentence, then give the reason.",
};

/** Main question and 3 Follow-ups, each answered; the Partner is about to reply to the last Answer. */
async function throughFollowUps() {
  const f = await startedSession();
  f.partnerSays("Laptops banned on weekends — good idea or not?");
  f.learnerAnswers(20, "silence", "Um, I think it's a good idea, but only partly.");
  f.partnerSays("What's the single strongest reason?");
  f.learnerAnswers(10, "done", "The queue at the door.");
  f.partnerSays("So what changes for the business?");
  f.learnerAnswers(10, "done", "More tables turn over.");
  f.partnerSays("But the laptop people buy lunch. Doesn't that kill your argument?");
  return f;
}

describe("Session — Coaching point, Redo, Better version", () => {
  it("after the last Follow-up, has the Partner cover the wait while the Coach brain reads the Round's verbatim Answers", async () => {
    const f = await throughFollowUps();
    expect(f.nextReply()?.text).toMatch(/say only: "Okay, let me think about that for a second."/);

    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();

    expect(f.pointCalls).toHaveLength(1);
    expect(f.pointCalls[0].input).toEqual({
      mainQuestion: Q1,
      exchanges: [
        { question: "Laptops banned on weekends — good idea or not?", answer: "Um, I think it's a good idea, but only partly." },
        { question: "What's the single strongest reason?", followUpType: "why", answer: "The queue at the door." },
        { question: "So what changes for the business?", followUpType: "soWhat", answer: "More tables turn over." },
        { question: "But the laptop people buy lunch. Doesn't that kill your argument?", followUpType: "counterexample", answer: "They mostly come on weekdays." },
      ],
    });
    f.partnerSays("Okay, let me think about that for a second.");
    expect(f.session.view().step).toEqual({ kind: "coaching", round: 1 });
    expect(f.session.view().thread.at(-1)).toEqual({ kind: "partner", step: "covering", text: "Okay, let me think about that for a second." });
  });

  it("has the Partner speak the Coach brain's Coaching point word for word, then ask the Main question again for the Redo", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    f.pointCalls[0].reply.resolve(POINT);
    await settle();

    const speak = f.lastCommand();
    expect(speak?.cmd).toBe("speak");
    const said = speak && "text" in speak ? speak.text : "";
    expect(said).toContain(`You said: "${POINT.quote}"`);
    expect(said).toContain(POINT.fix);
    expect(said).toContain(Q1);
    expect(said).toMatch(/word for word/);

    f.partnerSays("One thing to work on. You said: ...");
    expect(f.session.view().thread.at(-1)).toEqual({ kind: "coaching", point: POINT, redoQuestion: Q1 });
    expect(f.session.view()).toMatchObject({ step: { kind: "redo", round: 1 }, activity: "yourTurn" });
  });

  it("asks the Coach brain for exactly one Coaching point per Round", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    f.partnerSays("One thing to work on. You said: ...");

    f.learnerAnswers(15, "done", "My call is a partial ban.");
    f.partnerSays("Thanks. I'll put a tighter version of your answer on the screen.");
    await settle();

    expect(f.pointCalls).toHaveLength(1);
    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toHaveLength(1);
  });

  it("covers a slow Coach brain with another covering line, so the learner never sits in silence for long", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    const speaks = () => f.commands.filter((c) => c.cmd === "speak").length;
    const before = speaks();

    f.clock.advance(900);
    expect(speaks()).toBe(before);
    f.clock.advance(100);
    expect(speaks()).toBe(before + 1);
    const cover = f.speaks().at(-1)!;
    // A covering line promises nothing: the Coach brain may still fail.
    expect(cover).not.toMatch(/work on|one thing|point|comment/i);

    f.partnerSays("Bear with me a moment.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();

    expect(f.lastCommand()).toMatchObject({ cmd: "speak", text: expect.stringContaining(`nothing else: "One thing to work on. You said: "${POINT.quote}"`) });
  });

  it("waits for the Partner to finish its covering line before speaking the Coaching point", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.emit({ type: "partnerTurnStarted" });
    f.emit({ type: "partnerText", text: "Okay, let me think about that for a second." });

    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    expect(f.lastCommand()?.cmd).not.toBe("speak");

    f.emit({ type: "partnerTurnEnded", interrupted: false });
    expect(f.lastCommand()).toMatchObject({ cmd: "speak", text: expect.stringContaining(`One thing to work on. You said: "${POINT.quote}"`) });
  });

  it("keeps the Partner only covering if the learner speaks during the wait, and keeps that out of the Round's Answers", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    expect(f.nextReply()?.text).toMatch(/still preparing.*Do not give feedback and do not ask anything/);

    f.emit({ type: "learnerTurnStarted" });
    f.clock.advance(3000);
    expect(f.lastCommand()?.cmd).toBe("setNextReply"); // no covering line over the learner
    f.emit({ type: "learnerTurnEnded", speechMs: 2000, by: "silence", audio: audioOf("So how did I do?") });
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    expect(f.lastCommand()?.cmd).not.toBe("speak"); // the Partner's reply to that is still coming
    f.partnerSays("One moment, I'm nearly there.");

    expect(f.lastCommand()).toMatchObject({ cmd: "speak", text: expect.stringContaining(POINT.quote) });
    expect(f.pointCalls).toHaveLength(1);
    expect(f.pointCalls[0].input.exchanges.map((x) => x.answer)).not.toContain("So how did I do?");
  });

  /** Through the Coaching point; the learner is about to do the Redo. */
  async function atRedo() {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    f.partnerSays("One thing to work on. You said: ...");
    return f;
  }

  it("records the Redo as a separate Answer", async () => {
    const f = await atRedo();

    f.learnerAnswers(18.4, "done", "My call is a partial ban.");

    expect(f.session.view().thread.at(-1)).toEqual({ kind: "answer", seconds: 18, redo: true });
    f.session.end();
    expect(f.store.sessions[0].rounds[0]).toMatchObject({ answerSeconds: [20, 10, 10, 12], redoSeconds: 18, coachingPoint: POINT });
  });

  it("moves on with its own line when the Better version fails, since the Coaching point was already given", async () => {
    const f = await atRedo();
    f.learnerAnswers(15, "done", "My call is a partial ban.");
    await settle();
    f.partnerSays("Thanks. I'll put a tighter version of your answer on the screen.");

    f.betterCalls[0].reply.reject(new Error("502"));
    await settle();

    const said = f.speaks().at(-1);
    expect(said).toContain(`Sorry, I couldn't write up a tighter version this time. Let's move on. ${Q2}`);
    expect(said).not.toMatch(/point together/);
    f.partnerSays("Sorry, I couldn't write up a tighter version this time. Let's move on. Should cafés stop taking cash?");
    expect(f.session.view().step).toEqual({ kind: "main", round: 2 });
    expect(f.session.view().thread.some((t) => t.kind === "betterVersion")).toBe(false);
    f.session.end();
    expect(f.store.sessions[0].rounds[0]).toMatchObject({ coachingPoint: POINT, redoSeconds: 15 });
    expect(f.store.sessions[0].rounds[0].betterVersion).toBeUndefined();
  });

  it("shows the Better version only after the Redo, built from the Redo, and has the Partner point to it", async () => {
    const f = await atRedo();
    expect(f.betterCalls).toHaveLength(0);
    expect(f.nextReply()?.text).toMatch(/tighter version of your answer on the screen/);

    f.learnerAnswers(15, "done", "My call is a partial ban. The bottleneck is tables.");
    await settle();
    expect(f.betterCalls).toHaveLength(1);
    expect(f.betterCalls[0].input).toMatchObject({
      mainQuestion: Q1,
      coachingPoint: POINT,
      redo: "My call is a partial ban. The bottleneck is tables.",
    });
    expect(f.betterCalls[0].input.exchanges).toHaveLength(4);

    f.partnerSays("Thanks. I'll put a tighter version of your answer on the screen.");
    f.betterCalls[0].reply.resolve("Partial ban: no laptops at the window tables on weekends. Tables are the bottleneck.");
    await settle();
    expect(f.session.view().thread.some((t) => t.kind === "betterVersion")).toBe(false);
    expect(f.lastCommand()).toMatchObject({ cmd: "speak", text: expect.stringContaining("Better version on your screen") });

    f.partnerSays("Have a look at the Better version on your screen.");
    expect(f.session.view().step).toEqual({ kind: "betterVersion", round: 1 });
    expect(f.session.view().thread.at(-1)).toEqual({
      kind: "betterVersion", text: "Partial ban: no laptops at the window tables on weekends. Tables are the bottleneck.",
    });
  });

  it("runs Coaching point → Redo → Better version, and saves the Round once", async () => {
    const f = await atRedo();
    f.learnerAnswers(15, "done", "My call is a partial ban.");
    await settle();
    f.partnerSays("Thanks. I'll put a tighter version of your answer on the screen.");
    f.betterCalls[0].reply.resolve("Partial ban.");
    await settle();
    f.partnerSays("Have a look at the Better version on your screen.");
    f.session.end();

    expect(f.session.view().thread.filter((t) => t.kind !== "partner" || t.step !== "covering").map((t) => (t.kind === "partner" ? t.step : t.kind)))
      .toEqual(["main", "answer", "followUp", "answer", "followUp", "answer", "followUp", "answer", "coaching", "answer", "betterVersion"]);
    expect(f.store.sessions).toHaveLength(1);
    expect(f.store.sessions[0]).toMatchObject({
      rounds: [{ followUpTypes: ["why", "soWhat", "counterexample"], answerSeconds: [20, 10, 10, 12], coachingPoint: POINT, redoSeconds: 15, betterVersion: "Partial ban." }],
    });
  });

  it("closes the Round without a Redo if the Coach brain fails, rather than letting the Partner improvise a Coaching point", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.partnerSays("Good idea or not?");
    for (let i = 0; i < 3; i++) {
      f.learnerAnswers(10);
      f.partnerSays("Follow-up?");
    }
    f.learnerAnswers(12);
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    f.pointCalls[0].reply.reject(new Error("503"));
    await settle();

    const said = f.speaks().at(-1);
    // Honest about it, rather than skipping ahead as if nothing was due.
    expect(said).toContain(`Sorry, I couldn't put a point together on that one. Let's move on. ${Q2}`);
    expect(said).not.toMatch(/You said/);
    f.partnerSays("Let's move on. Different topic. Should cafés stop taking cash?");
    expect(f.session.view().step).toEqual({ kind: "main", round: 2 });
    expect(f.session.view().thread.some((t) => t.kind === "coaching")).toBe(false);
    expect(f.betterCalls).toHaveLength(0);
    f.session.end();
    expect(store.sessions[0].rounds[0]).not.toHaveProperty("coachingPoint");
  });

  it("gives up on a Coach brain that is still not back after every covering line, instead of leaving the learner in silence", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    for (let i = 0; i < 3; i++) {
      f.clock.advance(1000);
      f.partnerSays("A covering line.");
    }

    f.clock.advance(1000);

    expect(f.speaks().at(-1)).toContain(Q2);
    const speaks = f.speaks().length;
    f.pointCalls[0].reply.resolve(POINT); // too late
    await settle();
    expect(f.speaks()).toHaveLength(speaks);
  });

  it("speaks the Coaching point again if the learner talked over it before the Partner started", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    const pointSpeak = f.lastCommand();
    expect(pointSpeak).toMatchObject({ cmd: "speak", text: expect.stringContaining(POINT.quote) });

    f.learnerAnswers(2, "silence", "Okay."); // the adapter drops the reply that was starting
    expect(f.nextReply()?.text).toMatch(/still preparing/);
    f.partnerSays("One moment, I'm nearly there.");

    expect(f.lastCommand()).toEqual(pointSpeak);
    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toHaveLength(0);
    f.partnerSays("One thing to work on. You said: ...");
    expect(f.session.view().thread.at(-1)).toMatchObject({ kind: "coaching", point: POINT });
    f.session.end();
    expect(f.store.sessions[0].rounds[0].answerSeconds).toEqual([20, 10, 10, 12]);
  });

  it("asks the Partner again if what it was told to say never comes", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    const pointSpeak = f.lastCommand();
    const speaks = () => f.commands.filter((c) => c.cmd === "speak").length;
    const before = speaks();

    f.clock.advance(8000);

    expect(speaks()).toBe(before + 1);
    expect(f.lastCommand()).toEqual(pointSpeak);
  });

  it("keeps waiting for the Coaching point if the learner asks the Partner to repeat its question meanwhile", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    f.learnerAnswers(2, "done", "Sorry, what was the question?");
    f.partnerSays("But the laptop people buy lunch. Doesn't that kill your argument?");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();

    expect(f.lastCommand()).toMatchObject({ cmd: "speak", text: expect.stringContaining(POINT.quote) });
    expect(f.pointCalls).toHaveLength(1);
  });

  it("gives one Coaching point built on the whole Answer when the learner goes on after a pause", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "silence", "They mostly come on weekdays.");
    await settle();
    f.learnerAnswers(5, "done", "And they order less.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    expect(f.pointCalls.at(-1)?.input.exchanges.at(-1)?.answer).toBe("They mostly come on weekdays. And they order less.");
    f.pointCalls[0].reply.resolve({ ...POINT, quote: "stale" });
    f.pointCalls.at(-1)!.reply.resolve(POINT);
    await settle();
    f.partnerSays("One thing to work on. You said: ...");

    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toEqual([
      { kind: "coaching", point: POINT, redoQuestion: Q1 },
    ]);
  });

  it("still asks the Coach brain when an Answer couldn't be transcribed", async () => {
    const f = await throughFollowUps();
    f.transcriber.fail = true;
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();

    expect(f.pointCalls[0].input.exchanges.at(-1)).toMatchObject({ answer: "" });
  });

  it("closes the Round without a Better version if the Coach brain fails on it", async () => {
    const f = await atRedo();
    f.learnerAnswers(15, "done", "My call is a partial ban.");
    await settle();
    f.partnerSays("Thanks. I'll put a tighter version of your answer on the screen.");

    f.betterCalls[0].reply.reject(new Error("503"));
    await settle();
    expect(f.speaks().at(-1)).toContain(Q2);
    f.partnerSays("Let's move on. Different topic.");

    expect(f.session.view().step).toEqual({ kind: "main", round: 2 });
    expect(f.session.view().thread.some((t) => t.kind === "betterVersion")).toBe(false);
  });

  it("treats a request to repeat the question during the Redo as a repeat, not as the Redo", async () => {
    const f = await atRedo();

    f.learnerAnswers(2, "done", "Sorry, could you repeat the question?");
    await settle();
    f.partnerSays(`Sure. ${Q1}`);
    expect(f.session.view().step).toEqual({ kind: "redo", round: 1 });
    expect(f.session.view().thread.at(-1)).toMatchObject({ kind: "partner", step: "redo", repeat: true });
    expect(f.nextReply()?.text).toMatch(/tighter version/);

    f.learnerAnswers(15, "done", "My call is a partial ban.");
    await settle();
    expect(f.betterCalls.at(-1)?.input.redo).toBe("My call is a partial ban.");
    f.session.end();
    expect(f.store.sessions[0].rounds[0].redoSeconds).toBe(15);
  });

  it("says nothing more once End is tapped while the Coach brain works", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    f.session.end();
    f.clock.advance(5000);
    f.pointCalls[0].reply.resolve(POINT);
    await settle();

    expect(f.lastCommand()).toEqual({ cmd: "close" });
  });

  it("keeps what the learner says during a wait out of the Better version's Answers too", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.learnerAnswers(2, "silence", "So how did I do?");
    f.partnerSays("One moment, I'm nearly there.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    f.partnerSays("One thing to work on. You said: ...");

    f.learnerAnswers(15, "done", "My call is a partial ban.");
    await settle();

    expect(f.betterCalls[0].input.exchanges.map((x) => x.answer)).toEqual([
      "Um, I think it's a good idea, but only partly.", "The queue at the door.", "More tables turn over.", "They mostly come on weekdays.",
    ]);
  });
});

type Started = Awaited<ReturnType<typeof startedSession>>;

const POINT_2: CoachingPoint = {
  dimension: "structure",
  quote: "and also, like, the card thing",
  fix: "Give two separate reasons, one at a time, before you say what it means.",
};

/**
 * Plays a whole Round from the Partner asking its Main question to the Partner pointing at the Better version, with
 * 3 Follow-ups. The learner is then reading the Better version.
 */
async function playRound(f: Started, n: 1 | 2, point: CoachingPoint = n === 1 ? POINT : POINT_2) {
  f.partnerSays(`Main question ${n}?`);
  for (let i = 1; i <= 3; i++) {
    f.clock.advance(20_000);
    f.learnerAnswers(15, "done", `Round ${n} answer ${i}.`);
    f.partnerSays(`Round ${n} Follow-up ${i}?`);
  }
  f.learnerAnswers(12, "done", `Round ${n} answer 4.`);
  await settle();
  f.partnerSays("Okay, let me think about that for a second.");
  f.pointCalls.at(-1)!.reply.resolve(point);
  await settle();
  f.partnerSays(`You said: "${point.quote}" ...`);
  f.learnerAnswers(15, "done", `Round ${n} Redo.`);
  await settle();
  f.partnerSays("Thanks. I'll put a tighter version of your answer on the screen.");
  f.betterCalls.at(-1)!.reply.resolve(`Better version ${n}.`);
  await settle();
  f.partnerSays("Have a look at the Better version on your screen. Tap Next when you're ready.");
}

describe("Session — two Rounds and a Transfer question", () => {
  it("lets the learner read the Better version, then moves to Round 2's Main question when they tap Next", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    expect(f.speaks().at(-1)).toMatch(/Better version on your screen.*Tap Next when you're ready/);
    expect(f.session.view()).toMatchObject({ step: { kind: "betterVersion", round: 1 }, activity: "reading", canNext: true, canDone: false });
    const speaksBefore = f.speaks().length;

    f.clock.advance(20_000);
    expect(f.speaks()).toHaveLength(speaksBefore); // no hurry while they read
    f.session.next();

    expect(f.session.view().canNext).toBe(false);
    expect(f.speaks().at(-1)).toContain(Q2);
    f.partnerSays(Q2);
    expect(f.session.view().step).toEqual({ kind: "main", round: 2 });
    f.learnerAnswers(20);
    f.partnerSays("Which reason matters most?");
    expect(f.session.view().step).toMatchObject({ kind: "followUp", round: 2, n: 1 });
    expect(f.nextReply()?.text).toContain('Follow-up of type "Be specific"');
  });

  it("picks Round 2's Follow-up types counting the ones already asked in Round 1", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();

    f.partnerSays(Q2);
    const types: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      f.clock.advance(20_000);
      f.learnerAnswers(15);
      f.partnerSays("Follow-up?");
      const step = f.session.view().step;
      types.push(step?.kind === "followUp" && step.type);
    }

    // Round 1 asked Why, So what and Counterexample.
    expect(types).toEqual(["changeYourMind", "beSpecific", "haveYouConsidered"]);
  });

  it("moves on by itself if the learner hasn't tapped Next after 30 s", async () => {
    const f = await startedSession();
    await playRound(f, 1);

    f.clock.advance(30_000);

    expect(f.speaks().at(-1)).toContain(`Let's move on. ${Q2}`);
    expect(f.session.view().canNext).toBe(false);
    f.session.next(); // a late tap changes nothing
    expect(f.speaks().filter((t) => t.includes(Q2))).toHaveLength(1);
  });

  it("has the Partner only nudge if the learner talks while reading, and keeps that out of the Round's Answers", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    expect(f.nextReply()?.text).toMatch(/reading the Better version.*Tap Next/);

    f.learnerAnswers(3, "silence", "Hmm, okay, that makes sense.");
    expect(f.session.view().canNext).toBe(false);
    f.partnerSays("Take your time. Tap Next when you're ready.");
    expect(f.session.view()).toMatchObject({ step: { kind: "betterVersion", round: 1 }, activity: "reading", canNext: true });
    expect(f.session.view().thread.at(-1)).toMatchObject({ kind: "partner", step: "nudge" });

    f.session.next();
    expect(f.speaks().at(-1)).toContain(Q2);
    f.session.end();
    expect(f.store.sessions[0].rounds[0].answerSeconds).toEqual([15, 15, 15, 12]);
  });

  it("runs Round 1 → Round 2 → Transfer question → wrap-up, with exactly one Coaching point per Round and no Redo after the Transfer", async () => {
    const f = await startedSession();
    const steps: unknown[] = [];
    f.session.subscribe((v) => { if (JSON.stringify(v.step) !== JSON.stringify(steps.at(-1))) steps.push(v.step); });

    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    expect(f.speaks().at(-1)).toContain(Q3);
    f.partnerSays(Q3);
    expect(f.nextReply()?.text).toMatch(/say only: "Okay, let me think about that for a second."/);
    f.learnerAnswers(25, "done", "No. Reservations protect the busy nights.");
    await settle();
    expect(f.transferCalls).toHaveLength(1);
    expect(f.transferCalls[0].input).toEqual({
      question: Q3,
      answer: "No. Reservations protect the busy nights.",
      coachingPoints: [POINT, POINT_2],
    });
    f.partnerSays("Okay, let me think about that for a second.");
    f.focusCalls[0].reply.resolve(FOCUS);
    f.transferCalls[0].reply.resolve("Your position came first this time; now give the second reason its own sentence.");
    await settle();
    expect(f.speaks().at(-1)).toMatch(/word for word.*Your position came first this time; now give the second reason its own sentence\./);
    f.partnerSays("Your position came first this time; now give the second reason its own sentence.");
    expect(f.session.view().thread.at(-1)).toEqual({
      kind: "transferComment", text: "Your position came first this time; now give the second reason its own sentence.",
    });
    expect(f.speaks().at(-1)).toContain("That's the end of the Session");
    f.partnerSays("That's the end of the Session. Have a look at the summary on your screen. Thanks, and see you next time.");

    const kinds = steps.map((st) => {
      const x = st as { kind: string; round?: number };
      return x.round ? `${x.kind} ${x.round}` : x.kind;
    });
    expect(kinds.filter((k, i) => k !== kinds[i - 1] && !k.startsWith("followUp"))).toEqual([
      "main 1", "coaching 1", "redo 1", "betterVersion 1",
      "main 2", "coaching 2", "redo 2", "betterVersion 2",
      "transfer", "wrapUp", "ended",
    ]);
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "complete" });
    expect(f.pointCalls).toHaveLength(2);
    expect(f.betterCalls).toHaveLength(2);
    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toHaveLength(2);
    expect(f.store.sessions).toHaveLength(1);
    expect(f.store.sessions[0]).toMatchObject({
      endReason: "complete",
      rounds: [
        { mainQuestion: Q1, followUpTypes: ["why", "soWhat", "counterexample"], answerSeconds: [15, 15, 15, 12], coachingPoint: POINT, redoSeconds: 15, betterVersion: "Better version 1." },
        { mainQuestion: Q2, followUpTypes: ["changeYourMind", "beSpecific", "haveYouConsidered"], answerSeconds: [15, 15, 15, 12], coachingPoint: POINT_2, redoSeconds: 15, betterVersion: "Better version 2." },
      ],
      transfer: { question: Q3, answerSeconds: 25, comment: "Your position came first this time; now give the second reason its own sentence." },
    });
  });

  it("wraps up without a comment if the Coach brain fails on the Transfer Answer", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    f.partnerSays(Q3);
    f.learnerAnswers(25);
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    f.focusCalls[0].reply.resolve(FOCUS);
    f.transferCalls[0].reply.reject(new Error("503"));
    await settle();

    expect(f.speaks().at(-1)).toContain(`That's the end of the Session. Your Next focus for next time: ${FOCUS}`);
    f.partnerSays("That's the end of the Session. Have a look at the summary on your screen. Thanks, and see you next time.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "complete" });
    expect(f.session.view().thread.some((t) => t.kind === "transferComment")).toBe(false);
  });
});

describe("Session — time cap", () => {
  const CAP = 12 * 60_000;
  /** Advances the clock to exactly the time cap. */
  const toCap = (f: Started) => f.clock.advance(CAP - (f.clock.now() - 1_000_000));

  /** Round 1 done; Round 2's Main question asked and answered, and its first Follow-up asked. */
  async function intoRound2() {
    const store = memoryStore();
    const f = await startedSession({ store });
    await playRound(f, 1);
    f.session.next();
    f.partnerSays(Q2);
    f.learnerAnswers(20, "done", "No, keep cash.");
    f.partnerSays("Is there any situation where you'd say the opposite?");
    return f;
  }

  it("has the Partner wrap up at 12:00 in the middle of Round 2, and ends the Session with timeCap", async () => {
    const f = await intoRound2();
    f.clock.advance(60_000);
    const speaks = f.speaks().length;

    toCap(f);

    expect(f.speaks()).toHaveLength(speaks + 1);
    expect(f.speaks().at(-1)).toMatch(/out of time.*summary on your screen/);
    f.partnerSays("We're out of time, so let's stop there. Have a look at the summary on your screen. Thanks, and see you next time.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
    expect(f.store.sessions[0]).toMatchObject({
      endReason: "timeCap",
      rounds: [{ coachingPoint: POINT }, { mainQuestion: Q2, followUpTypes: ["changeYourMind"], answerSeconds: [20] }],
    });
    expect(f.store.sessions[0]).not.toHaveProperty("transfer");
  });

  it("lets the learner finish an open turn, and ends when the Partner's reply to it is the wrap-up", async () => {
    const f = await intoRound2();
    f.emit({ type: "learnerTurnStarted" });
    const speaks = f.speaks().length;

    toCap(f);

    expect(f.speaks()).toHaveLength(speaks);
    expect(f.nextReply()?.text).toMatch(/out of time.*summary on your screen/);
    f.emit({ type: "learnerTurnEnded", speechMs: 9000, by: "done", audio: audioOf("Only for very small payments.") });
    f.partnerSays("We're out of time, so let's stop there. Have a look at the summary on your screen. Thanks, and see you next time.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
    expect(f.session.view().thread.at(-1)).toMatchObject({ kind: "partner", step: "wrapUp" });
    expect(f.speaks()).toHaveLength(speaks);
  });

  it("wraps up right after the Partner's reply if that reply was the Follow-up it had been told to ask", async () => {
    // A note sent while the learner's turn is open often doesn't change the reply already planned for it.
    const f = await intoRound2();
    f.emit({ type: "learnerTurnStarted" });
    toCap(f);
    f.emit({ type: "learnerTurnEnded", speechMs: 9000, by: "done", audio: audioOf("Only for very small payments.") });

    f.partnerSays("Put a number on it. How much money are we talking about?");

    expect(f.session.view().step).toMatchObject({ kind: "followUp", round: 2, n: 2 });
    expect(f.speaks().at(-1)).toMatch(/out of time/);
    f.partnerSays("We're out of time, so let's stop there. Have a look at the summary on your screen. Thanks, and see you next time.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
  });

  it("doesn't start the Coach brain on an Answer that ends after 12:00", async () => {
    const f = await intoRound2();
    for (let i = 0; i < 2; i++) {
      f.learnerAnswers(10);
      f.partnerSays("Follow-up?");
    }
    f.emit({ type: "learnerTurnStarted" }); // the last Answer of the Round
    toCap(f);
    f.emit({ type: "learnerTurnEnded", speechMs: 9000, by: "done", audio: audioOf("That's my answer.") });
    await settle();

    expect(f.pointCalls).toHaveLength(1); // Round 1's only
    f.partnerSays("Okay, let me think about that for a second.");
    expect(f.speaks().at(-1)).toMatch(/out of time/);
  });

  it("drops a Coaching point that is still being prepared at 12:00", async () => {
    const f = await intoRound2();
    for (let i = 0; i < 2; i++) {
      f.learnerAnswers(10);
      f.partnerSays("Follow-up?");
    }
    f.learnerAnswers(10);
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");

    toCap(f);
    expect(f.speaks().at(-1)).toMatch(/out of time/);
    f.pointCalls.at(-1)!.reply.resolve(POINT_2);
    await settle();
    f.clock.advance(1000);
    expect(f.speaks().at(-1)).toMatch(/out of time/);
    expect(f.speaks().filter((t) => t.includes(POINT_2.quote))).toHaveLength(0);

    f.partnerSays("We're out of time, so let's stop there. Have a look at the summary on your screen. Thanks, and see you next time.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
    expect(f.store.sessions[0].rounds[1]).not.toHaveProperty("coachingPoint");
  });

  it("lets a line the Partner was already told to say finish, then wraps up instead of going on", async () => {
    const f = await intoRound2();
    for (let i = 0; i < 2; i++) {
      f.learnerAnswers(10);
      f.partnerSays("Follow-up?");
    }
    f.learnerAnswers(10);
    await settle();
    f.clock.advance(CAP - 5000 - (f.clock.now() - 1_000_000));
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls.at(-1)!.reply.resolve(POINT_2);
    await settle();
    const speaks = f.speaks().length; // the Coaching point is on its way

    toCap(f);
    f.clock.advance(7000);
    expect(f.speaks()).toHaveLength(speaks); // not sent twice, and nothing on top of it
    f.partnerSays(`You said: "${POINT_2.quote}" ...`);

    expect(f.speaks().at(-1)).toMatch(/out of time/);
    expect(f.nextReply()?.text).not.toMatch(/tighter version/);
    f.partnerSays("We're out of time, so let's stop there. Have a look at the summary on your screen. Thanks, and see you next time.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
  });

  it("still wraps up if the line the Partner was told to say never comes", async () => {
    const f = await intoRound2();
    f.learnerAnswers(10);
    f.partnerSays("Follow-up?");
    f.learnerAnswers(10);
    await settle();
    f.clock.advance(CAP - 5000 - (f.clock.now() - 1_000_000));
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls.at(-1)!.reply.resolve(POINT_2);
    await settle();

    toCap(f);
    f.clock.advance(8000);

    expect(f.speaks().at(-1)).toMatch(/out of time/);
  });

  it("ends with timeCap a minute after 12:00 even if the Partner never says its wrap-up", async () => {
    const f = await intoRound2();
    toCap(f);

    f.clock.advance(60_000);

    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
    expect(f.lastCommand()).toEqual({ cmd: "close" });
  });

  it("can be set shorter, for tests on the deployed app", async () => {
    const f = await startedSession({ timeCapMs: 90_000 });
    f.partnerSays("Good idea or not?");

    f.clock.advance(90_000);

    expect(f.speaks().at(-1)).toMatch(/out of time/);
  });
});

describe("Session — reconnecting mid-Session", () => {
  it("doesn't have the Partner ask a question twice when a reconnect overlaps the wait for it", async () => {
    const f = await startedSession();
    expect(f.speaks()).toHaveLength(1); // the Main question

    f.emit({ type: "resuming" });
    f.clock.advance(20_000); // a slow reconnect, longer than the speak retry
    f.emit({ type: "resumed" });
    f.clock.advance(3000);
    f.partnerSays(Q1);
    f.clock.advance(20_000);

    expect(f.speaks()).toHaveLength(1);
    expect(f.session.view()).toMatchObject({ step: { kind: "main", round: 1 }, activity: "yourTurn" });
  });

  it("asks once more if what the Partner was told to say was lost in the reconnect", async () => {
    const f = await startedSession();
    f.emit({ type: "resuming" });
    f.emit({ type: "resumed" });

    f.clock.advance(7999);
    expect(f.speaks()).toHaveLength(1);
    f.clock.advance(1);
    expect(f.speaks()).toHaveLength(2);
    expect(f.speaks()[1]).toBe(f.speaks()[0]);
  });

  it("carries on at the same step of Round 2 after a reconnect, without asking anything again", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    f.partnerSays(Q2);
    f.learnerAnswers(20);
    f.partnerSays("Is there any situation where you'd say the opposite?");
    const speaks = f.speaks().length;

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed" });
    f.clock.advance(10_000);

    expect(f.speaks()).toHaveLength(speaks);
    expect(f.session.view()).toMatchObject({ step: { kind: "followUp", round: 2, n: 1 }, activity: "yourTurn" });
    f.learnerAnswers(15);
    f.partnerSays("Put a number on it.");
    expect(f.session.view().step).toMatchObject({ kind: "followUp", round: 2, n: 2, type: "beSpecific" });
  });

  it("keeps the reading step and Next across a reconnect", async () => {
    const f = await startedSession();
    await playRound(f, 1);

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed" });

    expect(f.session.view()).toMatchObject({ step: { kind: "betterVersion", round: 1 }, activity: "reading", canNext: true });
  });

  it("asks the adapter to hold connection swaps only while it waits to have the Partner speak", async () => {
    const f = await throughFollowUps();
    const holds = () => f.commands.flatMap((c) => (c.cmd === "holdSwap" ? [c.hold] : []));
    expect(holds()).toEqual([]);

    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    expect(holds()).toEqual([true]); // the Coach brain is working
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.clock.advance(500);
    expect(holds()).toEqual([true]);
    f.pointCalls[0].reply.resolve(POINT);
    await settle();

    expect(holds()).toEqual([true, false]); // the Partner has its line; the adapter waits for its reply anyway
    expect(f.commands.findIndex((c) => c.cmd === "holdSwap" && !c.hold)).toBeGreaterThan(
      f.commands.findIndex((c) => c.cmd === "speak" && c.text.includes(POINT.quote)),
    );
  });
});

describe("Session — edge cases between steps", () => {
  it("still asks Round 2's Main question if the learner speaks just after tapping Next", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    const question = f.speaks().at(-1)!;
    expect(question).toContain(Q2);

    f.learnerAnswers(1, "silence", "Okay."); // the adapter drops the question that was starting
    f.partnerSays("One moment, I'm nearly there.");

    expect(f.speaks().at(-1)).toBe(question);
    f.partnerSays(Q2);
    expect(f.session.view().step).toEqual({ kind: "main", round: 2 });
    f.learnerAnswers(20);
    f.partnerSays("Is there any situation where you'd say the opposite?");
    expect(f.session.view().step).toMatchObject({ kind: "followUp", round: 2, n: 1 });
    f.session.end();
    expect(f.store.sessions[0].rounds[1].answerSeconds).toEqual([20]);
  });

  it("doesn't count a request to repeat the question as an Answer", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    f.partnerSays(Q3);

    f.learnerAnswers(2, "done", "Sorry, could you repeat that?");
    f.partnerSays(`Sure. ${Q3}`);
    f.learnerAnswers(25, "done", "No. Reservations protect the busy nights.");
    await settle();

    expect(f.transferCalls.at(-1)!.input.answer).toBe("No. Reservations protect the busy nights.");
    f.session.end();
    expect(f.store.sessions[0].transfer).toMatchObject({ answerSeconds: 25 });
  });

  it("has the Partner say a line again in full if a reconnect cut it off", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    const pointSpeak = f.speaks().at(-1)!;

    f.emit({ type: "partnerTurnStarted" });
    f.emit({ type: "partnerText", text: "One thing to work on. You said" });
    f.emit({ type: "resuming" });
    f.emit({ type: "partnerTurnEnded", interrupted: false, cut: true });
    f.emit({ type: "resumed" });

    expect(f.speaks().at(-1)).toBe(pointSpeak);
    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toHaveLength(0);
    f.partnerSays("One thing to work on. You said: ...");
    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toHaveLength(1);
    expect(f.session.view().step).toEqual({ kind: "redo", round: 1 });
  });

  it("has the Partner ask a Follow-up again in full if a reconnect cut it off", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(20);

    f.emit({ type: "partnerTurnStarted" });
    f.emit({ type: "partnerText", text: "What's the single" });
    f.emit({ type: "partnerTurnEnded", interrupted: false, cut: true });

    // The note said "when the learner finishes"; they have, so the Partner is told to ask it now.
    expect(f.speaks().at(-1)).toMatch(/^\[Director\] The learner has just finished speaking\. Now ask one Follow-up of type "Why"/);
    f.partnerSays("What's the single strongest reason?");
    expect(f.session.view().step).toEqual({ kind: "followUp", round: 1, n: 1, type: "why" });
    expect(f.session.view().thread.filter((t) => t.kind === "partner" && t.step === "followUp")).toHaveLength(1);
  });
});

describe("Session — when transcription fails", () => {
  /** Main question and 3 Follow-ups with every transcription failing; the Partner is about to reply to the last Answer. */
  async function untranscribedRound() {
    const f = await startedSession();
    f.transcriber.fail = true;
    f.partnerSays("Good idea or not?");
    for (let i = 0; i < 3; i++) {
      f.learnerAnswers(10);
      f.partnerSays("Follow-up?");
    }
    return f;
  }

  it("doesn't ask the Coach brain for a Coaching point when none of the Round's Answers could be transcribed", async () => {
    const f = await untranscribedRound();
    f.learnerAnswers(12);
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    await settle();

    expect(f.pointCalls).toHaveLength(0);
    expect(f.speaks().at(-1)).toContain(`Sorry, I couldn't put a point together on that one. Let's move on. ${Q2}`);
  });

  it("wraps up without a Transfer comment when the Transfer Answer couldn't be transcribed", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    f.partnerSays(Q3);
    f.transcriber.fail = true;
    f.learnerAnswers(25);
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    await settle();
    expect(f.focusCalls[0].input).not.toHaveProperty("transfer"); // still based on the Coaching points
    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();

    expect(f.transferCalls).toHaveLength(0);
    expect(f.speaks().at(-1)).toMatch(/That's the end of the Session/);
  });
});

describe("Session — when the Live server misbehaves", () => {
  it("has the Partner say a turn again if it came with no words", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(20);

    f.partnerSays("...");

    expect(f.speaks().at(-1)).toMatch(/Now ask one Follow-up of type "Why"/);
    expect(f.session.view().thread.filter((t) => t.kind === "partner")).toHaveLength(1);
    f.partnerSays("What's the single strongest reason?");
    expect(f.session.view().step).toEqual({ kind: "followUp", round: 1, n: 1, type: "why" });
  });

  it("checks for words in lines that aren't shown as Partner bubbles too, such as the Coaching point", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    const pointSpeak = f.speaks().at(-1)!;

    f.partnerSays("");

    expect(f.speaks().at(-1)).toBe(pointSpeak);
    expect(f.session.view().thread.filter((t) => t.kind === "coaching")).toHaveLength(0);
  });

  it("stops asking again after two wordless turns, rather than loop", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(20);
    for (let i = 0; i < 3; i++) f.partnerSays("...");

    expect(f.speaks()).toHaveLength(3); // the Main question and two retries
    expect(f.session.view()).toMatchObject({ step: { kind: "followUp", n: 1 }, activity: "yourTurn" });
  });

  it("gives a fresh Live session the call so far, then asks for the reply that was lost", async () => {
    const f = await startedSession();
    f.partnerSays("Laptops banned on weekends — good idea or not?");
    f.learnerAnswers(20, "done", "Yes, but only at the window tables.");
    const speaks = f.speaks().length;

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed", fresh: true });
    await settle();

    const context = f.commands.find((c) => c.cmd === "addContext") as { text: string };
    expect(context.text).toContain("Laptops banned on weekends — good idea or not?");
    expect(context.text).toContain("Yes, but only at the window tables.");
    expect(f.commands.findIndex((c) => c === context)).toBeLessThan(f.commands.length - 1);
    expect(f.speaks()).toHaveLength(speaks + 1);
    expect(f.speaks().at(-1)).toMatch(/Now ask one Follow-up of type "Why"/);
    f.partnerSays("What's the single strongest reason?");
    expect(f.session.view().step).toEqual({ kind: "followUp", round: 1, n: 1, type: "why" });
  });

  it("after a fresh session, has the Partner say a line it hadn't started", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    const pointSpeak = f.speaks().at(-1)!;

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed", fresh: true });
    await settle();

    expect(f.commands.at(-2)?.cmd).toBe("addContext");
    expect(f.speaks().at(-1)).toBe(pointSpeak);
    expect(f.speaks().filter((t) => t === pointSpeak)).toHaveLength(2);
  });

  it("after a fresh session while the learner is answering, sets up the Partner's next reply again", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    const note = f.nextReply()!.text;
    f.emit({ type: "learnerTurnStarted" });
    const speaks = f.speaks().length;

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed", fresh: true });
    await settle();

    expect(f.speaks()).toHaveLength(speaks);
    expect(f.commands.at(-2)?.cmd).toBe("addContext");
    expect(f.lastCommand()).toEqual({ cmd: "setNextReply", text: note });
  });
});


/** Both Rounds played; the Partner has asked the Transfer question and the learner has answered it. */
async function throughTransferAnswer(f: Started) {
  await playRound(f, 1);
  f.session.next();
  await playRound(f, 2);
  f.session.next();
  f.partnerSays(Q3);
  f.learnerAnswers(25, "done", "No. Reservations protect the busy nights.");
  await settle();
  f.partnerSays("Okay, let me think about that for a second.");
}

const FOCUS = "Give your yes or no in the first sentence, even on a question you haven't seen.";
const COMMENT = "Your position came first this time; now give the second reason its own sentence.";

describe("Session — summary and Next focus", () => {
  it("asks for the Next focus with the Transfer Answer, and the Partner says it word for word in the wrap-up", async () => {
    const f = await startedSession();
    await throughTransferAnswer(f);

    expect(f.focusCalls).toHaveLength(1);
    expect(f.focusCalls[0].input).toEqual({
      rounds: [
        { mainQuestion: Q1, coachingPoint: POINT, redo: "Round 1 Redo." },
        { mainQuestion: Q2, coachingPoint: POINT_2, redo: "Round 2 Redo." },
      ],
      transfer: { question: Q3, answer: "No. Reservations protect the busy nights." },
    });
    f.focusCalls[0].reply.resolve(FOCUS);
    f.transferCalls[0].reply.resolve(COMMENT);
    await settle();
    f.partnerSays(COMMENT);

    expect(f.speaks().at(-1)).toMatch(/word for word.*That's the end of the Session\. Your Next focus for next time: Give your yes or no in the first sentence, even on a question you haven't seen\. Have a look at the summary/);
    f.partnerSays(`That's the end of the Session. Your Next focus for next time: ${FOCUS} Have a look at the summary on your screen.`);
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "complete" });
    await settle();
    expect(f.store.sessions[0]).toMatchObject({ nextFocus: FOCUS, transfer: { comment: COMMENT } });
    expect(f.session.summary()).toEqual({ record: f.store.sessions[0], complete: true });
  });

  it("saves each Round's Redo transcript, to show next to its Better version", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.end();

    expect(f.store.sessions[0].rounds[0]).toMatchObject({ redo: "Round 1 Redo.", redoSeconds: 15, betterVersion: "Better version 1." });
  });

  it("covers the wait if the Next focus isn't back when the Transfer comment ends", async () => {
    const f = await startedSession();
    await throughTransferAnswer(f);
    f.transferCalls[0].reply.resolve(COMMENT);
    await settle();
    f.partnerSays(COMMENT);
    const before = f.speaks().length;

    f.clock.advance(1000);
    expect(f.speaks()).toHaveLength(before + 1);
    expect(f.speaks().at(-1)).toMatch(/word for word.*"Bear with me a moment\."/);
    f.partnerSays("Bear with me a moment.");
    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();

    expect(f.speaks().at(-1)).toContain(`Your Next focus for next time: ${FOCUS}`);
  });

  it("wraps up without the Next focus if the Coach brain fails on it", async () => {
    const f = await startedSession();
    await throughTransferAnswer(f);
    f.transferCalls[0].reply.resolve(COMMENT);
    f.focusCalls[0].reply.reject(new Error("503"));
    await settle();
    f.partnerSays(COMMENT);

    expect(f.speaks().at(-1)).toMatch(/word for word.*"That's the end of the Session\. Have a look at the summary/);
    f.partnerSays("That's the end of the Session. Have a look at the summary on your screen.");
    await settle();
    expect(f.store.sessions[0]).not.toHaveProperty("nextFocus");
    expect(f.session.summary()?.complete).toBe(true);
  });

  it("wraps up without the Next focus after the covering lines, and adds it to the summary when it comes", async () => {
    const f = await startedSession();
    await throughTransferAnswer(f);
    f.transferCalls[0].reply.resolve(COMMENT);
    await settle();
    f.partnerSays(COMMENT);
    for (const line of ["Bear with me a moment.", "Nearly there.", "Sorry, just a moment longer."]) {
      f.clock.advance(1000);
      f.partnerSays(line);
    }
    f.clock.advance(1000);

    expect(f.speaks().at(-1)).toMatch(/"That's the end of the Session\. Have a look at the summary/);
    f.partnerSays("That's the end of the Session. Have a look at the summary on your screen.");
    expect(f.session.summary()).toMatchObject({ complete: false });
    expect(f.store.sessions[0]).not.toHaveProperty("nextFocus");
    let told = 0;
    f.session.subscribe(() => told++);

    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();

    expect(f.store.sessions).toHaveLength(1);
    expect(f.store.sessions[0].nextFocus).toBe(FOCUS);
    expect(f.session.summary()).toEqual({ record: f.store.sessions[0], complete: true });
    expect(told).toBeGreaterThan(0);
  });

  it("asks for a Next focus when the learner ends the call early, once there is a Coaching point", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    f.partnerSays(Q2);
    f.learnerAnswers(20, "done", "Yes, cash is slow.");

    f.session.end();
    await settle();

    expect(f.focusCalls).toHaveLength(1);
    expect(f.focusCalls[0].input).toEqual({
      rounds: [
        { mainQuestion: Q1, coachingPoint: POINT, redo: "Round 1 Redo." },
        { mainQuestion: Q2 },
      ],
    });
    expect(f.session.summary()?.complete).toBe(false);
    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();
    expect(f.store.sessions[0].nextFocus).toBe(FOCUS);
    expect(f.session.summary()?.complete).toBe(true);
  });

  it("doesn't ask for a Next focus when the Session ended before any Coaching point", async () => {
    const f = await startedSession();
    f.partnerSays("Good idea or not?");
    f.learnerAnswers(20);

    f.session.end();
    await settle();

    expect(f.focusCalls).toHaveLength(0);
    expect(f.session.summary()?.complete).toBe(true);
  });

  it("saves a Redo whose transcript comes in after the call ended", async () => {
    const f = await throughFollowUps();
    f.learnerAnswers(12, "done", "They mostly come on weekdays.");
    await settle();
    f.partnerSays("Okay, let me think about that for a second.");
    f.pointCalls[0].reply.resolve(POINT);
    await settle();
    f.partnerSays(`You said: "${POINT.quote}" ...`);
    const slow = deferred<{ text: string; words: [] }>();
    f.transcriber.transcribe = () => slow.promise;
    f.learnerAnswers(15, "done");

    f.session.end();
    expect(f.store.sessions[0].rounds[0]).toMatchObject({ redoSeconds: 15 });
    expect(f.store.sessions[0].rounds[0]).not.toHaveProperty("redo");

    slow.resolve({ text: "Partly yes: ban them at the window tables.", words: [] });
    await settle();
    expect(f.store.sessions).toHaveLength(1);
    expect(f.store.sessions[0].rounds[0].redo).toBe("Partly yes: ban them at the window tables.");
  });

  it("opens the next Session with the Partner reminding the learner of the last Next focus, word for word", async () => {
    const store = memoryStore();
    const first = await startedSession({ store });
    await throughTransferAnswer(first);
    first.focusCalls[0].reply.resolve(FOCUS);
    first.transferCalls[0].reply.resolve(COMMENT);
    await settle();
    first.partnerSays(COMMENT);
    first.partnerSays("That's the end of the Session. …");
    expect(first.speaks()[0]).toMatch(/^\[Director\] Greet the learner/); // the first Session has nothing to remind

    const second = await startedSession({ store });

    expect(second.speaks()).toHaveLength(1);
    expect(second.speaks()[0]).toMatch(/word for word.*"Hi\. Your focus from last time: Give your yes or no in the first sentence, even on a question you haven't seen\."/);
    expect(second.session.view().step).toEqual({ kind: "opening" });
    second.partnerSays(`Hi. Your focus from last time: ${FOCUS}`);
    expect(second.session.view().thread.at(-1)).toMatchObject({ kind: "partner", step: "opening" });

    expect(second.speaks().at(-1)).toMatch(/word for word.*First question\. The owner is thinking about banning laptops/);
    second.partnerSays(`First question. ${Q1}`);
    expect(second.session.view()).toMatchObject({ step: { kind: "main", round: 1 }, activity: "yourTurn" });
    second.learnerAnswers(20);
    second.partnerSays("Why?");
    expect(second.session.view().step).toMatchObject({ kind: "followUp", round: 1, n: 1 });
  });

  it("reminds the learner of the latest Next focus, skipping Sessions that ended without one", async () => {
    const at = (startedAt: number, nextFocus?: string): SessionRecord => ({
      id: `s-${startedAt}`, sceneId: "01-corner-cafe", startedAt, endedAt: startedAt + 1, endReason: "complete", rounds: [],
      ...(nextFocus ? { nextFocus } : {}),
    });
    const f = await startedSession({ store: memoryStore([at(1, "Older focus."), at(3), at(2, "Latest focus.")]) });

    expect(f.speaks()[0]).toContain("Your focus from last time: Latest focus.");
  });

  it("says the Next focus in the time-up line when it is already known", async () => {
    const f = await startedSession({ timeCapMs: 20 * 60_000 });
    await throughTransferAnswer(f);
    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();

    f.clock.advance(20 * 60_000);

    expect(f.speaks().at(-1)).toMatch(/We're out of time, so let's stop there\. Your Next focus for next time: Give your yes or no/);
  });

  it("keeps a Session deleted if its Next focus comes in afterwards", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.end();
    await settle();

    await f.store.deleteSession(f.store.sessions[0].id);
    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();

    expect(f.store.sessions).toHaveLength(0);
    expect(f.session.summary()).toMatchObject({ record: { nextFocus: FOCUS }, complete: true });
  });

  it("keeps what the learner says during the Next focus wait out of the Transfer Answer", async () => {
    const f = await startedSession();
    await throughTransferAnswer(f);
    f.transferCalls[0].reply.resolve(COMMENT);
    await settle();
    f.partnerSays(COMMENT);

    f.learnerAnswers(2, "silence", "Okay, thanks.");
    await settle();
    f.partnerSays("One moment, I'm nearly there.");
    f.focusCalls[0].reply.resolve(FOCUS);
    await settle();

    expect(f.transferCalls).toHaveLength(1);
    expect(f.focusCalls).toHaveLength(1);
    expect(f.speaks().at(-1)).toContain(`Your Next focus for next time: ${FOCUS}`);
    expect(f.session.view().thread.at(-2)).toMatchObject({ kind: "answer", aside: true });
  });

  it("asks for the Next focus again when the learner goes on with the Transfer Answer, and uses only the later one", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    f.partnerSays(Q3);
    f.learnerAnswers(10, "silence", "No.");
    await settle();
    f.learnerAnswers(15, "done", "Reservations protect the busy nights.");
    await settle();

    expect(f.focusCalls).toHaveLength(2);
    expect(f.focusCalls[1].input.transfer?.answer).toBe("No. Reservations protect the busy nights.");
    f.focusCalls[0].reply.resolve("Stale focus.");
    f.focusCalls[1].reply.resolve(FOCUS);
    f.partnerSays("Okay, let me think about that for a second.");
    f.transferCalls.at(-1)!.reply.resolve(COMMENT);
    await settle();
    f.partnerSays(COMMENT);

    expect(f.speaks().at(-1)).toContain(`Your Next focus for next time: ${FOCUS}`);
  });

  it("drops the Next focus wait at the time cap and wraps up", async () => {
    const f = await startedSession({ timeCapMs: 20 * 60_000 });
    await throughTransferAnswer(f);
    f.transferCalls[0].reply.resolve(COMMENT);
    await settle();
    f.partnerSays(COMMENT);

    f.clock.advance(20 * 60_000);

    expect(f.speaks().at(-1)).toMatch(/"We're out of time, so let's stop there\. Have a look at the summary/);
    f.partnerSays("We're out of time, so let's stop there. Have a look at the summary on your screen.");
    expect(f.session.view().step).toEqual({ kind: "ended", reason: "timeCap" });
  });

  it("tells a fresh Live session about the Next focus the Session opened with", async () => {
    const past: SessionRecord = { id: "s-1", sceneId: "01-corner-cafe", startedAt: 1, endedAt: 2, endReason: "complete", rounds: [], nextFocus: FOCUS };
    const f = await startedSession({ store: memoryStore([past]) });
    f.partnerSays(`Hi. Your focus from last time: ${FOCUS}`);
    f.partnerSays(`First question. ${Q1}`);

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed", fresh: true });
    await settle();

    const brief = f.commands.find((c) => c.cmd === "addContext");
    expect(brief && "text" in brief && brief.text).toContain(`Your focus from last time: ${FOCUS}`);
  });
});

describe("Session — Thinking pattern and Structure hint", () => {
  const [ANSWER_FIRST, FIRST_READ, TWO_OPTIONS] = THINKING_PATTERNS;
  // "Short answer: yes — here's why." and "My bottom line is …" (Answer first), "So the question is whether …" (any).
  const PHRASES = [HOLDING_PHRASES[0], HOLDING_PHRASES[2], HOLDING_PHRASES[1]];
  // Each Session starts later than the one before, as Session ids come from the start time.
  let startAt = 1_000_000;
  const practised = (store = memoryStore()) => startedSession({ store, holdingPhrases: PHRASES, startAt: (startAt += 3_600_000) });

  it("in the first Session, has the Partner introduce today's Thinking pattern in one sentence, then ask the Main question", async () => {
    const f = await practised();

    expect(f.speaks()).toHaveLength(1);
    expect(f.speaks()[0]).toContain(`word for word, and nothing else: "Hi. ${ANSWER_FIRST.intro}"`);
    expect(f.session.view()).toMatchObject({ step: { kind: "opening" }, pattern: { pattern: ANSWER_FIRST, introducing: true } });
    // The skeleton and its example are on the screen, so the Partner only names the pattern.
    expect(f.session.view().thread).toEqual([{ kind: "pattern", pattern: ANSWER_FIRST }]);
    f.partnerSays(`Hi. ${ANSWER_FIRST.intro}`);
    expect(f.session.view().thread.at(-1)).toMatchObject({ kind: "partner", step: "opening" });
    expect(f.speaks().at(-1)).toMatch(/word for word.*"First question\. The owner is thinking about banning laptops/);
    f.partnerSays(`First question. ${Q1}`);
    expect(f.session.view().step).toEqual({ kind: "main", round: 1 });

    f.session.end();
    expect(f.store.sessions[0]).toMatchObject({ thinkingPattern: "answerFirst", patternIntroduced: true });
  });

  it("introduces one new pattern per Session while any is left, then opens later Sessions straight with the Main question", async () => {
    const store = memoryStore();
    for (const pattern of [ANSWER_FIRST, FIRST_READ, TWO_OPTIONS]) {
      const f = await practised(store);
      expect(f.speaks()[0]).toContain(`"Hi. ${pattern.intro}"`);
      f.partnerSays(`Hi. ${pattern.intro}`);
      f.session.end();
    }

    const later = await practised(store);

    expect(later.speaks()).toHaveLength(1);
    expect(later.speaks()[0]).toMatch(/^\[Director\] Greet the learner/);
    expect(later.speaks()[0]).not.toMatch(/pattern/i);
    expect(later.session.view().thread).toEqual([]);
    // Each pattern was used once, so today's is the first again; the reference panel no longer shows it.
    expect(later.session.view()).toMatchObject({ step: { kind: "main", round: 1 }, pattern: { pattern: ANSWER_FIRST, introducing: false } });
    later.session.end();
    expect(store.sessions.at(-1)).toMatchObject({ thinkingPattern: "answerFirst" });
    expect(store.sessions.at(-1)).not.toHaveProperty("patternIntroduced");
  });

  it("introduces the same pattern again if the last Session ended before the Partner said it", async () => {
    const store = memoryStore();
    const first = await practised(store);
    first.session.end();

    const second = await practised(store);

    expect(second.speaks()[0]).toContain(ANSWER_FIRST.intro);
  });

  it("puts the Next focus reminder and the pattern intro in one opening", async () => {
    const past: SessionRecord = { id: "s-1", sceneId: "01-corner-cafe", startedAt: 1, endedAt: 2, endReason: "complete", rounds: [], nextFocus: FOCUS };
    const f = await practised(memoryStore([past]));

    expect(f.speaks()).toHaveLength(1);
    expect(f.speaks()[0]).toContain(`"Hi. Your focus from last time: ${FOCUS} ${ANSWER_FIRST.intro}"`);
  });

  it("tells a fresh Live session about the pattern it introduced", async () => {
    const f = await practised();
    f.partnerSays(`Hi. ${ANSWER_FIRST.intro}`);
    f.partnerSays(`First question. ${Q1}`);

    f.emit({ type: "resuming" });
    f.emit({ type: "resumed", fresh: true });
    await settle();

    const brief = f.commands.find((c) => c.cmd === "addContext");
    expect(brief && "text" in brief && brief.text).toContain(ANSWER_FIRST.intro);
  });

  it("shows the Hint silently, with today's pattern and one of the learner's Holding phrases, and counts each use", async () => {
    const f = await practised();
    f.partnerSays(`Hi. ${ANSWER_FIRST.intro}`);
    f.partnerSays(`First question. ${Q1}`);
    const sent = f.commands.length;

    f.session.hint();
    // The phrases that fit today's pattern come first, then the others.
    expect(f.session.view().hint).toEqual({ pattern: ANSWER_FIRST, phrase: PHRASES[0] });
    f.session.hint();
    expect(f.session.view().hint).toBeNull();
    f.session.hint();
    expect(f.session.view().hint).toEqual({ pattern: ANSWER_FIRST, phrase: PHRASES[2] });
    f.session.hint();
    f.session.hint();
    expect(f.session.view().hint).toEqual({ pattern: ANSWER_FIRST, phrase: PHRASES[1] });
    expect(f.commands).toHaveLength(sent); // the Partner is never told

    f.session.end();
    expect(f.store.sessions[0].hintUses).toBe(3);
  });

  it("closes the Hint when the Partner asks its next question", async () => {
    const f = await practised();
    f.partnerSays(`Hi. ${ANSWER_FIRST.intro}`);
    f.partnerSays(`First question. ${Q1}`);
    f.session.hint();

    f.learnerAnswers(20);
    expect(f.session.view().hint).not.toBeNull();
    f.partnerSays("Why that one?");

    expect(f.session.view().hint).toBeNull();
  });

  it("closes the Hint when the call ends", async () => {
    const f = await practised();
    f.session.hint();
    f.session.end();
    expect(f.session.view().hint).toBeNull();
    f.session.hint();
    expect(f.session.view().hint).toBeNull();
    expect(f.store.sessions[0].hintUses).toBe(1);
  });

  it("records no Hint use when there was none", async () => {
    const f = await practised();
    f.session.end();
    expect(f.store.sessions[0].hintUses).toBe(0);
  });
});

describe("Question bank", () => {
  const scene = (id: string, category: Category): Scene => ({ id, title: id, when: "Mon · 09:00", setting: `${id} setting`, category, image: null });
  const question = (sceneId: string, n: number, category: Category): BankQuestion =>
    ({ id: `${sceneId}/${n}`, sceneId, category, difficulty: "easy", text: `${sceneId} question ${n}?` });
  const BANK = {
    scenes: [scene("cafe", "Everyday decisions"), scene("train", "Tech & society"), scene("market", "Personal opinions")],
    questions: [
      ...[1, 2, 3, 4].map((n) => question("cafe", n, "Everyday decisions")),
      ...[1, 2, 3].map((n) => question("train", n, "Tech & society")),
      ...[1, 2].map((n) => question("market", n, "Personal opinions")),
    ],
  };
  const NONE: QuestionMarks = { seen: [], struck: [] };
  const ids = (q: SessionQuestions | null) => (q ? [...q.rounds, q.transfer].map((x) => x.id) : null);
  // Picks the first option every time, or the last.
  const first = () => 0;
  const last = () => 0.999;

  it("takes three different questions from one Scene, two for the Rounds and one for the Transfer question", () => {
    for (const random of [first, last, Math.random]) {
      const chosen = chooseQuestions(BANK, NONE, null, random)!;
      const all = [...chosen.rounds, chosen.transfer];
      expect(new Set(all.map((q) => q.id)).size).toBe(3);
      expect(all.every((q) => q.sceneId === chosen.scene.id)).toBe(true);
    }
  });

  it("only chooses questions that are neither seen nor struck, and skips a Scene with fewer than three left", () => {
    const marks: QuestionMarks = { seen: ["cafe/1"], struck: ["cafe/2", "train/3"] };
    for (const random of [first, last]) expect(chooseQuestions(BANK, marks, null, random)).toBeNull();

    const one: QuestionMarks = { seen: ["cafe/1"], struck: ["train/3"] };
    for (const random of [first, last]) expect(ids(chooseQuestions(BANK, one, null, random))?.sort()).toEqual(["cafe/2", "cafe/3", "cafe/4"]);
  });

  it("filters by category, and has nothing to offer for a category that is used up", () => {
    for (const random of [first, last, Math.random]) {
      expect(chooseQuestions(BANK, NONE, "Tech & society", random)!.scene.id).toBe("train");
      expect(chooseQuestions(BANK, NONE, "Personal opinions", random)).toBeNull();
    }
    expect(chooseQuestions(BANK, { seen: ["train/1"], struck: [] }, "Tech & society", first)).toBeNull();
  });

  it("needs a new choice once one of the chosen questions is seen or struck", () => {
    const chosen = chooseQuestions(BANK, NONE, "Tech & society")!;
    expect(stillUnused(chosen, NONE)).toBe(true);
    expect(stillUnused(chosen, { seen: [], struck: [chosen.transfer.id] })).toBe(false);
    expect(stillUnused(chosen, { seen: [chosen.rounds[0].id], struck: [] })).toBe(false);
    expect(stillUnused(chosen, { seen: ["cafe/1"], struck: ["cafe/2"] })).toBe(true);
  });

  it("Random draws from every category with questions left", () => {
    const scenes = new Set([first, last].map((random) => chooseQuestions(BANK, NONE, null, random)!.scene.id));
    expect(scenes).toEqual(new Set(["cafe", "train"]));
  });

  it("asks the Session's three questions in order, each word for word", async () => {
    const f = await startedSession();
    expect(f.speaks()[0]).toContain(Q1);
    await playRound(f, 1);
    f.session.next();
    expect(f.speaks().at(-1)).toContain(`Second question. ${Q2}`);
    await playRound(f, 2);
    f.session.next();
    expect(f.speaks().at(-1)).toContain(`Last one, quickly. ${Q3}`);
  });

  it("marks each question seen once the Partner has asked it, so an unasked one stays unseen", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    expect(store.marks.seen).toEqual([]);
    f.partnerSays(Q1);
    await settle();
    expect(store.marks.seen).toEqual([PLAN.rounds[0].id]);

    f.session.end();
    await settle();
    expect(store.marks.seen).toEqual([PLAN.rounds[0].id]);
    expect(store.sessions[0]).toMatchObject({ sceneId: "01-corner-cafe", questionIds: [PLAN.rounds[0].id] });
  });

  it("marks all three seen in a full Session, and the next choice avoids them", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    f.partnerSays(Q3);
    await settle();
    expect(store.marks.seen).toEqual([PLAN.rounds[0].id, PLAN.rounds[1].id, PLAN.transfer.id]);

    const bank = { scenes: [PLAN.scene], questions: QUESTIONS.filter((q) => q.sceneId === PLAN.scene.id) };
    for (let i = 0; i < 20; i++) {
      const next = chooseQuestions(bank, await store.loadQuestionMarks(), null);
      for (const id of ids(next) ?? []) expect(store.marks.seen).not.toContain(id);
    }
  });
});

/** Retries at app start, without the real waits between requests. */
const NO_WAIT: Pace = { wait: async () => {} };

describe("Session — speech metrics", () => {
  /** A transcript as gemini-3.5-transcribe returns it: each word with its start, ms into the Answer's audio. */
  const said = (...words: [string, number][]): Transcript => ({
    text: words.map(([w]) => w).join(" "),
    words: words.map(([text, startMs]) => ({ text, startMs, endMs: startMs + 250 })),
  });
  /** The Partner asks; the learner's turn opens `afterMs` later and runs for `seconds`. */
  function askAndAnswer(f: Started, question: string, afterMs: number, seconds: number, says: string) {
    f.partnerSays(question);
    f.clock.advance(afterMs);
    f.learnerAnswers(seconds, "done", says);
  }
  /** Ends the call and lets every transcription and the Coach brain's verdicts come in. */
  async function endAndMeasure(f: Started) {
    f.session.end();
    await settle();
    await settle();
    return f.session.summary()!;
  }

  it("measures Response latency from the end of the question to the first word of substance, skipping leading fillers", async () => {
    const f = await startedSession();
    // The turn opened 1.5 s after the question ended; its audio starts 320 ms before that (the pre-roll).
    f.transcriber.canned.set("ummed", said(["Um,", 100], ["uh,", 600], ["I'd", 1200], ["ban", 1400], ["them.", 1600]));
    askAndAnswer(f, Q1, 1500, 10, "ummed");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers[0]).toMatchObject({ kind: "main", latencyMs: 1500 - 320 + 1200, fillers: 2 });
    expect(record.metrics?.responseLatencyMs).toBe(2380);
  });

  it("counts a Holding phrase as the start of the Answer, after any fillers before it", async () => {
    const f = await startedSession();
    f.transcriber.canned.set("held", said(["Um,", 100], ["my", 700], ["first", 900], ["read", 1100], ["is", 1300], ["yes.", 1500]));
    f.transcriber.canned.set("not assessed", said(
      ["So", 400], ["the", 600], ["question", 800], ["is", 1000], ["whether", 1200], ["we", 1400], ["can.", 1600],
      ["Not", 2000], ["fully", 2200], ["assessed", 2400], ["yet", 2600], ["—", 2700], ["my", 2800], ["first", 3000], ["read", 3200], ["is", 3400], ["no.", 3600],
    ));
    askAndAnswer(f, Q1, 2000, 8, "held");
    f.partnerSays("Why?");
    f.clock.advance(1000);
    f.learnerAnswers(8, "done", "not assessed");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers.map((a) => a.latencyMs)).toEqual([2000 - 320 + 700, 1000 - 320 + 400]);
    expect(record.metrics?.answers.map((a) => a.holdingPhrases)).toEqual([1, 2]);
    expect(record.metrics?.holdingPhrases).toBe(3);
  });

  it("finds the first word of substance in a later turn when the first turn was only fillers", async () => {
    const f = await startedSession();
    f.transcriber.canned.set("um only", said(["Um…", 200]));
    f.transcriber.canned.set("then the call", said(["Yes,", 300], ["ban", 600], ["them.", 900]));
    askAndAnswer(f, Q1, 1000, 1, "um only");
    f.clock.advance(6000); // the turn closed after a long quiet, then the learner went on
    f.learnerAnswers(5, "done", "then the call");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers[0]).toMatchObject({ latencyMs: 7000 - 320 + 300, fillers: 1 });
  });

  it("counts a Holding phrase once when said with a filler or a dropped word inside, and one right after it too", async () => {
    const f = await startedSession();
    f.transcriber.canned.set("phrases", said(
      ["Not", 100], ["fully", 300], ["assessed,", 500], ["um,", 800], ["my", 1100], ["first", 1300], ["read", 1500], ["is", 1700], ["yes.", 1900],
      ["There", 2300], ["are", 2400], ["two", 2500], ["options.", 2700], ["My", 3000], ["bottom", 3200], ["line", 3400], ["is", 3600], ["cash.", 3800],
    ));
    askAndAnswer(f, Q1, 1000, 8, "phrases");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers[0].holdingPhrases).toBe(3);
  });

  it("has no latency for an Answer that opened while the Partner was still speaking", async () => {
    const f = await startedSession();
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");
    f.emit({ type: "partnerTurnStarted" });
    f.emit({ type: "partnerText", text: "Why" });
    f.clock.advance(500);
    f.learnerAnswers(6, "done", "Because tables.");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers.map((x) => x.latencyMs)).toEqual([1000 - 320 + 500, undefined]);
  });

  it("counts fillers per minute of speech from the verbatim words, not \"like\" as a verb or \"you know\" as a question", async () => {
    const f = await startedSession();
    f.transcriber.canned.set("fillers", said(
      ["Like,", 100], ["I", 400], ["think,", 500], ["you", 800], ["know,", 900], ["it's,", 1100], ["um,", 1300], ["kind", 1600], ["of", 1700], ["slow.", 1800],
      ["I", 2200], ["like", 2300], ["the", 2500], ["queue.", 2600], ["Do", 3000], ["you", 3100], ["know", 3200], ["why?", 3300],
      ["On", 3600], ["weekends,", 3700], ["like", 4000], ["a", 4100], ["table", 4200], ["is", 4400], ["basically", 4500], ["lost.", 4800],
      ["I'd", 5000], ["change", 5100], ["if", 5300], ["like", 5400], ["sales", 5600], ["fell,", 5800], ["in", 6000], ["places", 6100], ["like", 6300],
      ["because", 6500], ["people", 6800], ["like", 7000], ["places", 7200], ["like", 7400], ["this.", 7600],
    ));
    askAndAnswer(f, Q1, 1000, 30, "fillers");

    const { record } = await endAndMeasure(f);

    // Like, you know, um, kind of, like (after a comma), basically, like (after "if"), like (before "because"): 8 in 30 s.
    expect(record.metrics?.answers[0].fillers).toBe(8);
    expect(record.metrics?.fillersPerMinute).toBe(16);
    // The first word after the leading "Like," is the first word of substance.
    expect(record.metrics?.answers[0].latencyMs).toBe(1000 - 320 + 400);
  });

  it("measures each Answer's length, counting the Main question, Follow-ups and Transfer but not the Redo", async () => {
    const f = await startedSession();
    await playRound(f, 1);
    f.session.next();
    await playRound(f, 2);
    f.session.next();
    f.partnerSays(Q3);
    f.learnerAnswers(25, "done", "No. Reservations protect the busy nights.");

    const { record } = await endAndMeasure(f);

    const m = record.metrics!;
    expect(m.answers.map((a) => a.kind)).toEqual([...["main", "followUp", "followUp", "followUp"], ...["main", "followUp", "followUp", "followUp"], "transfer"]);
    expect(m.answers.map((a) => a.speechMs)).toEqual([15, 15, 15, 12, 15, 15, 15, 12, 25].map((x) => x * 1000));
    expect(m.answerSeconds).toBe(15.4);
  });

  it("joins an Answer split across turns, and has no latency for one that cut in on the question", async () => {
    const f = await startedSession();
    askAndAnswer(f, Q1, 1000, 10, "First half.");
    f.learnerAnswers(5, "done", "Second half, um, here.");
    f.emit({ type: "partnerTurnStarted" });
    f.emit({ type: "partnerText", text: "Why is" });
    f.emit({ type: "partnerTurnEnded", interrupted: true });
    f.learnerAnswers(6, "done", "Because tables.");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers).toEqual([
      { kind: "main", latencyMs: 1000 - 320 + 500, fillers: 1, speechMs: 15_000, holdingPhrases: 0, answerFirst: true },
      { kind: "followUp", fillers: 0, speechMs: 6000, holdingPhrases: 0, answerFirst: true },
    ]);
  });

  it("takes the question's end from when its audio finished playing", async () => {
    const f = await startedSession();
    f.emit({ type: "partnerTurnStarted" });
    f.emit({ type: "partnerText", text: Q1 });
    // The server said the turn was complete 400 ms after the last sound.
    f.emit({ type: "partnerTurnEnded", interrupted: false, sinceAudioEndedMs: 400 });
    f.clock.advance(1000);
    f.learnerAnswers(10, "done", "Yes, ban them.");

    const { record } = await endAndMeasure(f);

    expect(record.metrics?.answers[0].latencyMs).toBe(1400 - 320 + 500);
  });

  it("asks the Coach brain whether each Answer opens with the Answer step, and counts the verdicts", async () => {
    const f = await startedSession();
    f.judge.answerFirst = async (input) => input.answers.map((a) => a.answer.startsWith("Yes"));
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them at the window tables.");
    askAndAnswer(f, "Why?", 1000, 10, "Well, it depends on the café.");

    const { record } = await endAndMeasure(f);

    expect(f.answerFirstCalls).toEqual([{
      answers: [
        { question: Q1, answer: "Yes, ban them at the window tables." },
        { question: "Why?", answer: "Well, it depends on the café." },
      ],
    }]);
    expect(record.metrics?.answers.map((a) => a.answerFirst)).toEqual([true, false]);
    expect(record.metrics?.answerFirst).toEqual({ yes: 1, of: 2 });
  });

  it("shows the metrics without the first-sentence count if the Coach brain fails on it", async () => {
    const f = await startedSession();
    f.judge.answerFirst = () => Promise.reject(new Error("503"));
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");

    const { record, complete } = await endAndMeasure(f);

    expect(complete).toBe(true);
    expect(record.metrics).toMatchObject({ responseLatencyMs: 1000 - 320 + 500, answerSeconds: 10 });
    expect(record.metrics).not.toHaveProperty("answerFirst");
  });

  it("opens the summary at once and fills in the metrics when the last transcript comes in", async () => {
    const f = await startedSession();
    const slow = deferred<Transcript>();
    f.transcriber.transcribe = (audio) => (new TextDecoder().decode(audio) === "late" ? slow.promise : Promise.resolve({ text: "Yes.", words: timedWords("Yes.") }));
    askAndAnswer(f, Q1, 1000, 10, "Yes.");
    askAndAnswer(f, "Why?", 1000, 10, "late");

    f.session.end();
    await settle();
    expect(f.session.summary()).toMatchObject({ complete: false });
    expect(f.session.summary()?.record).not.toHaveProperty("metrics");
    expect(f.store.sessions).toHaveLength(1);

    slow.resolve({ text: "Because tables.", words: timedWords("Because tables.") });
    await settle();
    await settle();
    expect(f.session.summary()).toMatchObject({ complete: true, record: { metrics: { answers: [{}, {}] } } });
    expect(f.store.sessions[0].metrics?.answers).toHaveLength(2);
  });

  it("keeps no audio once every Answer has a timed transcript, and doesn't transcribe anything twice", async () => {
    const f = await startedSession();
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");
    askAndAnswer(f, "Why?", 1000, 10, "Because tables.");

    const { record } = await endAndMeasure(f);

    expect(record.metrics).toBeDefined();
    expect(record).not.toHaveProperty("metricsPending");
    expect(f.store.pending).toEqual([]);
    expect(f.transcriber.calls).toEqual(["Yes, ban them.", "Because tables."]);
  });

  it("transcribes again after the Session an Answer the fallback model transcribed during the call, with no word timings", async () => {
    const f = await startedSession();
    f.transcriber.untimed = true;
    askAndAnswer(f, Q1, 1000, 10, "Um, yes, ban them.");
    f.transcriber.untimed = false;

    const { record } = await endAndMeasure(f);

    expect(f.transcriber.calls).toEqual(["Um, yes, ban them.", "Um, yes, ban them."]);
    expect(record.metrics?.answers[0]).toMatchObject({ fillers: 1, latencyMs: 1000 - 320 + 800 });
    expect(f.store.pending).toEqual([]);
  });

  it("keeps the audio of an Answer it can't transcribe, and measures the Session once a later retry works", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");
    f.transcriber.fail = true;
    askAndAnswer(f, "Why?", 1000, 10, "Because tables.");

    f.session.end();
    await settle();
    await settle();
    expect(f.session.summary()?.complete).toBe(false);
    f.clock.advance(30_000); // the second retry
    await settle();
    await settle();

    expect(f.transcriber.calls).toEqual(["Yes, ban them.", "Because tables.", "Because tables.", "Because tables."]);
    expect(f.session.summary()).toMatchObject({ complete: true, record: { metricsPending: true } });
    expect(store.sessions[0]).not.toHaveProperty("metrics");
    expect(store.pending).toHaveLength(1);
    const [main, followUp] = store.pending[0].answers;
    expect(main.turns[0]).not.toHaveProperty("audio"); // transcribed: its audio is gone
    expect(main.turns[0].transcript?.text).toBe("Yes, ban them.");
    expect(new TextDecoder().decode(followUp.turns[0].audio)).toBe("Because tables.");

    // Next time the app opens.
    const transcriber = fakeTranscriber();
    await retryPendingMetrics({ store, transcriber, coach: fakeCoach().coach, pace: NO_WAIT });

    expect(transcriber.calls).toEqual(["Because tables."]);
    expect(store.pending).toEqual([]);
    expect(store.sessions[0]).not.toHaveProperty("metricsPending");
    expect(store.sessions[0].metrics?.answers.map((a) => a.latencyMs)).toEqual([1000 - 320 + 500, 1000 - 320 + 500]);
  });

  it("keeps the audio for another try when the later retry fails too, and drops it once the Session is deleted", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.transcriber.fail = true;
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");
    f.session.end();
    await settle();
    f.clock.advance(30_000);
    await settle();
    await settle();
    expect(store.pending).toHaveLength(1);

    const failing = fakeTranscriber();
    failing.fail = true;
    await retryPendingMetrics({ store, transcriber: failing, coach: fakeCoach().coach, pace: NO_WAIT });
    expect(store.pending[0].answers[0].turns[0].audio).toBeDefined();
    expect(store.sessions[0].metricsPending).toBe(true);

    store.sessions = [];
    const working = fakeTranscriber();
    await retryPendingMetrics({ store, transcriber: working, coach: fakeCoach().coach, pace: NO_WAIT });
    expect(working.calls).toEqual([]);
    expect(store.pending).toEqual([]);
  });

  it("takes a transcript that never comes back as failed, and retries it", async () => {
    const f = await startedSession();
    f.transcriber.transcribe = () => new Promise(() => {});
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");
    f.session.end();
    await settle();
    expect(f.session.summary()?.complete).toBe(false);
    const working = fakeTranscriber();
    f.transcriber.transcribe = (audio) => working.transcribe(audio);

    f.clock.advance(30_000);
    await settle();
    await settle();

    expect(working.calls).toEqual(["Yes, ban them."]);
    expect(f.session.summary()).toMatchObject({ complete: true, record: { metrics: { responseLatencyMs: 1000 - 320 + 500 } } });
  });

  it("sends the retries after the Session one at a time, spaced out for the model's rate limit", async () => {
    const f = await startedSession();
    f.transcriber.untimed = true;
    askAndAnswer(f, Q1, 1000, 10, "One.");
    askAndAnswer(f, "Why?", 1000, 10, "Two.");
    askAndAnswer(f, "So what?", 1000, 10, "Three.");
    f.transcriber.untimed = false;

    f.session.end();
    await settle();
    await settle();
    expect(f.transcriber.calls).toEqual(["One.", "Two.", "Three.", "One."]);
    f.clock.advance(RETRY_GAP_MS);
    await settle();
    expect(f.transcriber.calls.slice(3)).toEqual(["One.", "Two."]);
    f.clock.advance(RETRY_GAP_MS);
    await settle();
    await settle();

    expect(f.transcriber.calls.slice(3)).toEqual(["One.", "Two.", "Three."]);
    expect(f.session.summary()).toMatchObject({ complete: true, record: { metrics: { answers: [{}, {}, {}] } } });
  });

  it("gives up after MAX_RETRY_OPENS app opens: the audio is deleted and the Session has no metrics", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.transcriber.fail = true;
    askAndAnswer(f, Q1, 1000, 10, "Yes, ban them.");
    f.session.end();
    await settle();
    f.clock.advance(30_000);
    await settle();
    await settle();
    const failing = fakeTranscriber();
    failing.fail = true;

    for (let i = 1; i < MAX_RETRY_OPENS; i++) await retryPendingMetrics({ store, transcriber: failing, coach: fakeCoach().coach, pace: NO_WAIT });
    expect(store.pending[0]).toMatchObject({ tries: MAX_RETRY_OPENS - 1 });
    expect(store.sessions[0].metricsPending).toBe(true);
    await retryPendingMetrics({ store, transcriber: failing, coach: fakeCoach().coach, pace: NO_WAIT });

    expect(failing.calls).toHaveLength(MAX_RETRY_OPENS);
    expect(store.pending).toEqual([]);
    expect(store.sessions[0]).toMatchObject({ metricsUnavailable: true });
    expect(store.sessions[0]).not.toHaveProperty("metricsPending");
  });

  it("stops retrying at app start once a call begins, without counting it as a try", async () => {
    const store = memoryStore();
    const f = await startedSession({ store });
    f.transcriber.fail = true;
    askAndAnswer(f, Q1, 1000, 10, "One.");
    askAndAnswer(f, "Why?", 1000, 10, "Two.");
    f.session.end();
    await settle();
    f.clock.advance(RETRY_GAP_MS);
    await settle();
    f.clock.advance(30_000);
    await settle();
    f.clock.advance(RETRY_GAP_MS);
    await settle();
    await settle();
    expect(store.pending).toHaveLength(1);

    let inCall = false;
    const working = fakeTranscriber();
    // The call starts while the first request is out.
    const transcriber = { transcribe: (audio: ArrayBuffer) => { inCall = true; return working.transcribe(audio); } };
    await retryPendingMetrics({ store, transcriber, coach: fakeCoach().coach, pace: { ...NO_WAIT, stop: () => inCall } });

    expect(working.calls).toEqual(["One."]);
    expect(store.pending[0]).not.toHaveProperty("tries");
    expect(store.pending[0].answers[0].turns[0]).not.toHaveProperty("audio"); // the one that got through is kept
    expect(store.pending[0].answers[1].turns[0].audio).toBeDefined();
  });

  it("has no metrics when the Session ended before any Answer", async () => {
    const f = await startedSession();
    f.partnerSays(Q1);

    const { record, complete } = await endAndMeasure(f);

    expect(complete).toBe(true);
    expect(record).not.toHaveProperty("metrics");
    expect(record).not.toHaveProperty("metricsPending");
  });
});

describe("trend", () => {
  const session = (n: number, latency?: number): SessionRecord => ({
    id: `s-${n}`, sceneId: "01-corner-cafe", startedAt: n, endedAt: n + 1, endReason: "complete", rounds: [],
    ...(latency !== undefined
      ? { metrics: { answers: [], responseLatencyMs: latency, fillersPerMinute: n, answerSeconds: 20, holdingPhrases: 0, answerFirst: { yes: 1, of: 4 } } }
      : {}),
  });

  it("covers the last 8 Sessions that have the metric, oldest first, ending with the one shown", () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => session(n, n === 4 ? undefined : n * 100));
    sessions.push(session(11, 1100)); // after the one shown

    expect(trend(sessions, sessions[9], "responseLatency")).toEqual([200, 300, 500, 600, 700, 800, 900, 1000]);
    expect(trend(sessions, sessions[2], "fillerRate")).toEqual([1, 2, 3]);
    expect(trend(sessions, sessions[1], "answerFirst")).toEqual([0.25, 0.25]);
  });
});

describe("insight", () => {
  const at = (n: number, m: { latency?: number; fillers?: number; first?: [number, number] }): SessionRecord => ({
    id: `s-${n}`, sceneId: "01-corner-cafe", startedAt: n, endedAt: n + 1, endReason: "complete", rounds: [],
    metrics: {
      answers: [], fillersPerMinute: m.fillers ?? 4, answerSeconds: 30, holdingPhrases: 0,
      ...(m.latency !== undefined ? { responseLatencyMs: m.latency } : {}),
      ...(m.first ? { answerFirst: { yes: m.first[0], of: m.first[1] } } : {}),
    },
  });

  it("compares a Session with the average of the ones before it, lower being better for latency and fillers", () => {
    const sessions = [at(1, { latency: 10_000, fillers: 6, first: [3, 9] }), at(2, { latency: 12_000, fillers: 4, first: [5, 9] }), at(3, { latency: 8000, fillers: 5.2, first: [8, 9] })];
    expect(insight(sessions, sessions[2], "responseLatency")).toEqual({ metric: "responseLatency", value: 8000, average: 11_000, change: "better", best: true });
    expect(insight(sessions, sessions[2], "fillerRate")).toMatchObject({ average: 5, change: "same" });
    expect(insight(sessions, sessions[2], "answerFirst")).toMatchObject({ value: 8 / 9, change: "better", best: true });
    expect(insight(sessions, sessions[0], "fillerRate")).toEqual({ metric: "fillerRate", value: 6, change: "first", best: false });
  });

  it("points out the biggest improvement, else the biggest slip, else nothing", () => {
    const sessions = [at(1, { latency: 10_000, fillers: 4, first: [4, 8] }), at(2, { latency: 9000, fillers: 6, first: [6, 8] })];
    const now = (r: SessionRecord) => (["answerFirst", "responseLatency", "fillerRate"] as const).map((m) => insight([...sessions, r], r, m)!);

    // Latency 10% better, Answer first 25 points better: the Answer first is the bigger change.
    expect(headlineInsight(now(at(3, { latency: 8550, fillers: 5, first: [7, 8] })))?.metric).toBe("answerFirst");
    // Only slips: the biggest one, fillers up 60%.
    expect(headlineInsight(now(at(3, { latency: 10_500, fillers: 8, first: [5, 8] })))).toMatchObject({ metric: "fillerRate", change: "worse" });
    expect(headlineInsight(now(at(3, { latency: 9500, fillers: 5, first: [5, 8] })))).toBeNull();
  });
});
