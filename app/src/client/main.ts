import { QUESTIONS, SCENES, sceneTitle } from "../content/bank";
import { CATEGORIES, type Category, type QuestionBank, type SessionQuestions } from "../content/scene";
import { retryPendingMetrics } from "../engine/metrics";
import { chooseQuestions, createSession, lastNextFocus, stillUnused, todaysPattern } from "../engine/session";
import type { CallView, QuestionMarks, SessionRecord, Store } from "../engine/types";
import { MIC_CONSTRAINTS, setPlayAndRecord } from "./audio/capture";
import { httpCoach, httpTranscriber } from "./coach-http";
import { DebugLog, type Log } from "./debug-log";
import { createFakeMic } from "./fake-mic";
import { GeminiLive } from "./live/gemini-live";
import { DEFAULT_TURN_SETTINGS } from "./live/turn-detector";
import { runMicCheck } from "./mic-check-run";
import { loadSettings, pickedPhrases, saveSettings } from "./settings";
import { idbStore } from "./store";
import { mountCall, renderHistory, renderLogin, renderQuestionBank, renderReady, renderSetup, renderSummary } from "./ui";

const root = document.getElementById("root")!;
const params = new URLSearchParams(location.search);
const FAKE_MIC = params.get("fakeMic") === "1";
// ?soak=1 keeps the Partner asking Follow-ups until End, for 10–12 min call-stability tests on iPhone.
const SOAK = params.get("soak") === "1";
// ?swapAfter=60 makes the proactive connection swap happen after 60 s instead of 8.5 min.
const SWAP_AFTER_MS = Number(params.get("swapAfter")) * 1000 || undefined;
// ?coachDelay=4000 makes every Coach brain answer take at least 4 s, to test how the Partner covers a slow one.
const COACH_DELAY_MS = Number(params.get("coachDelay")) || 0;
// ?timeCap=150 has the Partner wrap up after 150 s instead of 12 min, to test the time cap.
const TIME_CAP_MS = Number(params.get("timeCap")) * 1000 || undefined;
// With ?fakeMic=1: ?fakeThink=20 waits 20 s more before each Answer, ?fakeRead=40 reads each Better version for 40 s
// before Next. Together they stretch a fake-mic Session to a real one's length.
const FAKE_THINK_MS = Number(params.get("fakeThink")) * 1000 || undefined;
const FAKE_READ_MS = Number(params.get("fakeRead")) * 1000 || undefined;
// ?simulateStall=90: from 90 s on the server "stops answering" until the adapter starts a fresh session.
const SIMULATE_STALL_MS = Number(params.get("simulateStall")) * 1000 || undefined;
const BANK: QuestionBank = { scenes: SCENES, questions: QUESTIONS };
// The fake mic's clips answer the Corner Café's first three questions, so it always gets those, and a fake-mic Session
// leaves the bank's seen marks alone.
const FAKE_MIC_QUESTIONS: SessionQuestions = {
  scene: SCENES.find((s) => s.id === "01-corner-cafe")!,
  rounds: [QUESTIONS.find((q) => q.id === "01-corner-cafe/1")!, QUESTIONS.find((q) => q.id === "01-corner-cafe/2")!],
  transfer: QUESTIONS.find((q) => q.id === "01-corner-cafe/3")!,
};
const store: Store = FAKE_MIC ? { ...idbStore, markSeen: async () => {} } : idbStore;

/** Saved Sessions; empty if storage is unavailable. */
const loadSessions = () => store.loadSessions().catch((e: Error) => { console.warn("sessions unavailable", e); return [] as SessionRecord[]; });
/** The learner's seen and struck marks; none if storage is unavailable. */
const loadMarks = () => store.loadQuestionMarks().catch((e: Error) => { console.warn("question marks unavailable", e); return { seen: [], struck: [] } as QuestionMarks; });

/** Ready's category (null: Random) and the Scene and questions it chose, kept until they're used or the category changes. */
let category: Category | null = null;
let chosen: SessionQuestions | null = null;

async function boot() {
  const me = await fetch("/api/me").catch(() => null);
  if (me?.ok) showReady();
  else renderLogin(root, login);
}

async function login(passcode: string) {
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
  if (r.ok) {
    showReady();
    return null;
  }
  const j = await r.json().catch(() => ({}));
  return j.error === "locked" ? `Too many tries. Try again in ${Math.ceil(j.retryAfterSec / 60)} min.` : "Wrong passcode.";
}

/**
 * Measures the Sessions whose Answers couldn't all be transcribed after their call (ticket 08), whenever Ready opens.
 * One run at a time, and it stops once a call starts: the call needs the transcription quota (10 a minute) itself.
 */
let retrying: Promise<void> | null = null;
let inCall = false;
const pace = { wait: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), stop: () => inCall };
function retryMetrics() {
  retrying ??= (async () => {
    const log = new DebugLog();
    try {
      if (inCall || !(await store.loadPendingMetrics()).length) return;
      log.log(`metrics retry ${log.id}`);
      await retryPendingMetrics({ store, transcriber: httpTranscriber(log.log), coach: httpCoach(log.log), pace });
      log.log(`metrics retry done; still pending: ${(await store.loadPendingMetrics()).map((p) => p.sessionId).join(", ") || "none"}`);
      await log.upload();
    } catch (e) {
      console.warn("metrics retry failed", e);
    }
  })().finally(() => { retrying = null; });
  return retrying;
}

async function showReady() {
  // Onboarding comes first, and the Call waits until exactly 3 Holding phrases are picked.
  if (!pickedPhrases(loadSettings()).length) return showSetup("onboarding");
  void retryMetrics();
  const [sessions, marks] = await Promise.all([loadSessions(), loadMarks()]);
  if (FAKE_MIC) chosen = FAKE_MIC_QUESTIONS;
  else if (!chosen || !stillUnused(chosen, marks)) chosen = chooseQuestions(BANK, marks, category);
  const open = Object.fromEntries(CATEGORIES.map((c) => [c, chooseQuestions(BANK, marks, c) !== null])) as Record<Category, boolean>;
  renderReady(root, { category, questions: chosen, open }, lastNextFocus(sessions), todaysPattern(sessions), {
    call: () => void call(), history: () => void showHistory(), settings: () => showSetup("settings"), bank: () => void showBank(),
    pick(picked) {
      category = picked;
      chosen = null;
      void showReady();
    },
  });
}

async function showBank() {
  renderQuestionBank(root, BANK, await loadMarks(), {
    strike: (id, struck) => store.setStruck(id, struck),
    back: () => void showReady(),
  });
}

/** Onboarding on first run; later, Settings (the Holding phrases and the mic check again). */
function showSetup(mode: "onboarding" | "settings") {
  renderSetup(root, mode, loadSettings(), {
    async checkMic(on) {
      const debugLog = new DebugLog();
      debugLog.log(`mic check ${debugLog.id} · ${navigator.userAgent}`);
      try {
        return await runMicCheck({ ...on, log: debugLog.log });
      } catch (e) {
        debugLog.log(`mic check failed: ${(e as Error).message}`);
        throw e;
      } finally {
        void debugLog.upload();
      }
    },
    save(settings) {
      saveSettings(settings);
      void showReady();
    },
    back: () => void showReady(),
  });
}

async function showHistory() {
  const sessions = await loadSessions();
  renderHistory(root, sessions, {
    sceneTitle,
    open: (record) => renderSummary(root, record, {
      pending: false, measuring: false, history: sessions, sceneTitle: sceneTitle(record.sceneId), backLabel: "Back to history", back: () => void showHistory(),
    }),
    remove: async (id) => { await store.deleteSession(id).catch(() => {}); void showHistory(); },
    removeAll: async () => { await store.deleteAllSessions().catch(() => {}); void showHistory(); },
    back: () => void showReady(),
  });
}

/** Everything the browser needs from the tap's user activation happens first, inside the tap. */
async function call() {
  const questions = chosen;
  if (!questions) return;
  inCall = true;
  const scene = questions.scene;
  const settings = loadSettings();
  const holdingPhrases = pickedPhrases(settings);
  const debugLog = new DebugLog();
  const log = debugLog.log;
  log(`call ${debugLog.id} · ${location.pathname}${location.search} · ${navigator.userAgent}`);
  log(`questions: ${scene.id} · ${[...questions.rounds, questions.transfer].map((q) => q.id).join(", ")}`);
  // The wake lock needs the tap's user activation, which the mic permission prompt would use up. A refusal is fine.
  const wakeLock = new WakeLock(log);
  let screen: ReturnType<typeof mountCall> | undefined;
  let ctx: AudioContext | undefined;
  let micStream: MediaStream | undefined;
  try {
    const audioSession = setPlayAndRecord();
    ctx = new AudioContext();
    await ctx.resume();
    log(`AudioContext ${ctx.sampleRate} Hz, ${ctx.state}, baseLatency ${ctx.baseLatency?.toFixed(3)} · audioSession ${audioSession}`);

    let micSource: AudioNode;
    let fake: Awaited<ReturnType<typeof createFakeMic>> | undefined;
    if (FAKE_MIC) {
      fake = await createFakeMic(ctx, log, { thinkMs: FAKE_THINK_MS, readMs: FAKE_READ_MS });
      micSource = fake.source;
    } else {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
      const st = micStream.getAudioTracks()[0].getSettings();
      log(`mic: echoCancellation=${st.echoCancellation} noiseSuppression=${st.noiseSuppression} agc=${st.autoGainControl} rate=${st.sampleRate}`);
      micSource = ctx.createMediaStreamSource(micStream);
    }

    // The mic check's levels fit the real mic only; the fake mic's clips are made for the defaults.
    const turn = settings.turn && !FAKE_MIC ? { ...DEFAULT_TURN_SETTINGS, speechRms: settings.turn.speechRms, bargeInRms: settings.turn.bargeInRms } : undefined;
    if (settings.turn) log(`mic check from ${new Date(settings.turn.checkedAt).toISOString()}: ${settings.turn.verdict}${FAKE_MIC ? " (not used with the fake mic)" : ""}`);
    log(`holding phrases: ${holdingPhrases.map((p) => p.id).join(", ")}`);
    const live = new GeminiLive({ ctx, micSource, log, swapAfterMs: SWAP_AFTER_MS, simulateStallAfterMs: SIMULATE_STALL_MS, turn });
    const clock = {
      now: () => Date.now(),
      after(ms: number, fn: () => void) {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      },
    };
    const session = createSession({
      live, clock, store, questions, coach: httpCoach(log, COACH_DELAY_MS), transcriber: httpTranscriber(log), keepGoing: SOAK,
      timeCapMs: TIME_CAP_MS, practice: { holdingPhrases },
    });
    screen = mountCall(root, scene, holdingPhrases, {
      hint: () => {
        session.hint();
        const hint = session.view().hint;
        log(hint ? `Hint shown: ${hint.pattern.id} · ${hint.phrase?.id ?? "no phrase"}` : "Hint hidden");
      },
      done: () => session.done(),
      next: () => { log("Next tapped"); session.next(); },
      end: () => session.end(),
    });
    fake?.drive(session, () => { log("fake mic: Done"); session.done(); }, () => { log("fake mic: Next"); session.next(); });
    debugLog.startUploading();

    let finished = false;
    let finishing = false;
    let leftSummary = false;
    /** Past Sessions, for the summary's trends; loaded once the call is over. */
    let history: SessionRecord[] = [];
    const showSummary = () => {
      const s = session.summary();
      if (!s || leftSummary) return;
      const pending = !s.complete && !s.record.nextFocus;
      const measuring = !s.complete && !s.record.metrics && !s.record.metricsPending;
      log(`session saved${pending ? " (Next focus pending)" : ""}${measuring ? " (metrics pending)" : ""}: ${JSON.stringify(s.record)}`);
      renderSummary(root, s.record, {
        pending, measuring, history: history.filter((r) => r.id !== s.record.id).concat(s.record), sceneTitle: scene.title, backLabel: "Done",
        back: () => { leftSummary = true; void showReady(); },
      });
    };
    const finish = async () => {
      if (finishing) return;
      finishing = true;
      micStream?.getTracks().forEach((t) => t.stop());
      wakeLock.release();
      await ctx!.close();
      inCall = false;
      history = await loadSessions();
      finished = true;
      shown = session.summary();
      showSummary();
      // Keep uploading until the Next focus is in, so the log has it.
      const settled = new Promise<void>((resolve) => {
        if (session.summary()?.complete) return resolve();
        const off = session.subscribe(() => { if (session.summary()?.complete) { off(); resolve(); } });
      });
      await Promise.race([settled, new Promise((r) => setTimeout(r, 20_000))]);
      await debugLog.stopUploading();
    };

    let last: CallView | undefined;
    let shown: unknown;
    session.subscribe((view) => {
      if (view.step?.kind === "ended") {
        if (last?.step?.kind !== "ended") {
          screen!.update(view);
          log(`step → ${JSON.stringify(view.step)}`);
          last = view;
          void finish();
        }
        // The summary replaces the call screen once the call has wound down, and updates when the Next focus comes.
        const summary = session.summary();
        if (finished && summary !== shown) {
          shown = summary;
          showSummary();
        }
        return;
      }
      screen!.update(view);
      if (JSON.stringify(view.step) !== JSON.stringify(last?.step)) log(`step → ${JSON.stringify(view.step)}`);
      if (view.pattern && !last?.pattern) log(`thinking pattern: ${view.pattern.pattern.id}${view.pattern.introducing ? " (introduced today)" : ""}`);
      if (view.activity !== last?.activity) log(`activity → ${view.activity}`);
      last = view;
    });

    await session.start();
  } catch (e) {
    inCall = false;
    log(`call failed: ${(e as Error).stack || (e as Error).message}`);
    micStream?.getTracks().forEach((t) => t.stop());
    wakeLock.release();
    void ctx?.close();
    await debugLog.stopUploading();
    await showReady();
    const msg = document.createElement("p");
    msg.className = "warn";
    msg.style.padding = "0 20px";
    msg.textContent = `Couldn't start the call: ${(e as Error).message}`;
    root.querySelector(".ready")?.append(msg);
  }
}

/** Keeps the screen on during a call; re-acquired when the page becomes visible again. */
class WakeLock {
  private lock: WakeLockSentinel | null = null;
  private active = true;

  constructor(private log: Log) {
    this.request();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private request() {
    if (!("wakeLock" in navigator)) return this.log("wake lock: API missing");
    navigator.wakeLock.request("screen").then(
      (l) => { this.lock = l; this.log("wake lock on"); },
      (e: Error) => this.log(`wake lock refused (ignored): ${e.message}`),
    );
  }

  private onVisibility = () => {
    this.log(`visibility: ${document.visibilityState}`);
    if (this.active && document.visibilityState === "visible" && (!this.lock || this.lock.released)) this.request();
  };

  release() {
    this.active = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.lock?.release().catch(() => {});
  }
}

void boot();
