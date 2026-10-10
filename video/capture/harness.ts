// Capture harness for the demo video: renders the app's own screens (ui.ts + styles.css) from scripted state, with no
// Worker, login, microphone or API key. capture.mjs drives it through window.shoot(name) and screenshots the result.
import { mountCall, renderReady, renderSummary } from "../../app/src/client/ui";
import { QUESTIONS, SCENES } from "../../app/src/content/bank";
import { HOLDING_PHRASES, THINKING_PATTERNS } from "../../app/src/content/practice";
import { CATEGORIES, type Category } from "../../app/src/content/scene";
import type { CallView, CoachingPoint, SessionRecord, ThreadItem } from "../../app/src/engine/types";

const scene = SCENES.find((s) => s.id === "01-corner-cafe")!;
// Round 1 asks the café's shortest question, so the film's shots read in a couple of seconds.
const [q2, q1, q3] = QUESTIONS.filter((q) => q.sceneId === scene.id);
const pattern = THINKING_PATTERNS[0];
const phrases = HOLDING_PHRASES.filter((p) => ["bottom-line", "question-is-whether", "first-read"].includes(p.id));
const noop = () => {};

// Scripted for the film: the question is the bank's own; the Follow-up, Coaching point, Redo and Better version are
// written short for the screen, not taken from a call.
const NEXT_FOCUS = "Give a clear yes or no in your very first sentence.";
const point: CoachingPoint = { dimension: "directness", quote: "Um, I think, it depends.", fix: "Open with your call: yes or no." };
const REDO = "Um, no. Cafés should keep cash, because, like, some regulars only carry cash.";
const BETTER = "No. Keep cash. Some regulars carry nothing else.";

const main: ThreadItem = { kind: "partner", step: "main", text: q1.text };
const hostile: ThreadItem = { kind: "partner", step: "followUp", followUpType: "hostileFraming", text: "So you'd turn away customers who only carry cash?" };
const answered = (seconds: number, redo = false): ThreadItem => ({ kind: "answer", seconds, redo });
const coaching: ThreadItem = { kind: "coaching", point, redoQuestion: q1.text };

const view = (elapsedMs: number, v: Partial<CallView>): CallView => ({
  step: null, activity: "idle", thread: [], canDone: false, canNext: false, hint: null,
  pattern: { pattern, introducing: false },
  ...v,
  startedAt: Date.now() - elapsedMs,
});

const followUp = { kind: "followUp", round: 1, n: 1, type: "hostileFraming" } as const;
const CALL: Record<string, CallView> = {
  "call-main": view(21_000, { step: { kind: "main", round: 1 }, activity: "partnerSpeaking", thread: [main] }),
  "call-hostile": view(47_000, { step: followUp, activity: "partnerSpeaking", thread: [main, answered(12), hostile] }),
  "call-listening": view(53_000, { step: followUp, activity: "listening", canDone: true, thread: [main, answered(12), hostile] }),
  "call-coaching": view(71_000, {
    step: { kind: "coaching", round: 1 }, activity: "partnerSpeaking", thread: [main, answered(12), hostile, answered(9), coaching],
  }),
};

const startedAt = new Date(2026, 9, 3, 10, 40).getTime();
// No metrics: the film shows no numbers as results, so the Speech metrics panel stays out of the shot.
const record: SessionRecord = {
  id: "demo", sceneId: scene.id, questionIds: [q1.id, q2.id, q3.id], startedAt, endedAt: startedAt + 9 * 60_000 + 48_000,
  endReason: "complete", nextFocus: NEXT_FOCUS, thinkingPattern: pattern.id, patternIntroduced: false, hintUses: 0,
  rounds: [
    { mainQuestion: q1.text, followUpTypes: ["hostileFraming"], answerSeconds: [12, 9], coachingPoint: point, redoSeconds: 7, redo: REDO, betterVersion: BETTER },
    { mainQuestion: q2.text, followUpTypes: ["why", "beSpecific"], answerSeconds: [14, 11, 10] },
  ],
  transfer: { question: q3.text, answerSeconds: 15 },
};

const root = document.getElementById("root")!;

function shoot(name: string) {
  root.innerHTML = "";
  if (name === "ready") {
    const open = Object.fromEntries(CATEGORIES.map((c) => [c, true])) as Record<Category, boolean>;
    renderReady(root, { category: scene.category, questions: { scene, rounds: [q1, q2], transfer: q3 }, open }, NEXT_FOCUS,
      { pattern, introduce: false }, { call: noop, history: noop, settings: noop, bank: noop, pick: noop });
  } else if (name === "summary") {
    renderSummary(root, record, { pending: false, measuring: false, history: [], sceneTitle: scene.title, backLabel: "Done", back: noop });
  } else if (CALL[name]) {
    mountCall(root, scene, phrases, { done: noop, next: noop, end: noop, hint: noop }).update(CALL[name]);
  } else {
    throw new Error(`unknown state: ${name}`);
  }
}

Object.assign(window, { shoot, STATES: ["ready", ...Object.keys(CALL), "summary"] });
