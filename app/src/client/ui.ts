// Screens: Login, Onboarding (and Settings), Ready, Question bank, Live call, Summary, History.
import { HOLDING_PHRASES, HOLDING_PHRASE_COUNT, patternById, type HoldingPhrase, type ThinkingPattern } from "../content/practice";
import { CATEGORIES, type BankQuestion, type Category, type QuestionBank, type Scene, type SessionQuestions } from "../content/scene";
import { headlineInsight, insight, trend, type MetricInsight, type TrendMetric } from "../engine/metrics";
import { FOLLOW_UP_LABEL } from "../engine/session";
import type { CallView, CoachingPoint, FollowUpType, QuestionMarks, RoundNumber, RubricDimension, SessionMetrics, SessionRecord, Step, ThreadItem } from "../engine/types";
import type { MicCheckResult } from "./mic-check";
import type { MicCheckPhase } from "./mic-check-run";
import type { Settings } from "./settings";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

const icon = {
  phone: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6V16h5.4v-.5c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  end: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 9c-1.6 0-3.2.3-4.6.7v3.1c0 .4-.2.7-.6.9-1 .5-1.9 1.1-2.7 1.8-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3L.3 13.1a1 1 0 0 1 0-1.4C3.3 8.8 7.5 7 12 7s8.7 1.8 11.7 4.7c.4.4.4 1 0 1.4l-2.4 2.4c-.2.2-.4.3-.7.3-.3 0-.5-.1-.7-.3a11 11 0 0 0-2.7-1.8c-.4-.2-.6-.5-.6-.9V9.7C15.2 9.3 13.6 9 12 9z"/></svg>',
};

const topbar = (right = "") =>
  `<div class="topbar"><div class="brand"><img class="brand-mark" src="icon.svg" alt="" width="22" height="22">Articulate</div>${right}</div>`;

const sceneArt = (scene: Scene) =>
  `<div class="scene${scene.image ? " has-image" : ""}" role="img" aria-label="${esc(scene.title)}"${scene.image ? ` style="background-image:url('${esc(scene.image)}')"` : ""}>` +
  `<div class="cap"><b>${esc(scene.title)}</b><span>${esc(scene.when)}</span></div></div>`;

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function renderLogin(root: HTMLElement, submit: (passcode: string) => Promise<string | null>) {
  root.innerHTML = `<div class="app">${topbar()}
    <form class="login">
      <h1 class="h-display" style="font-size:32px">Enter your passcode</h1>
      <input id="passcode" type="password" inputmode="numeric" autocomplete="current-password" maxlength="12" aria-label="Passcode" required>
      <button class="btn primary block" type="submit">Unlock</button>
      <div id="loginMsg" class="warn" role="status"></div>
    </form></div>`;
  const form = $<HTMLFormElement>(root, "form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = await submit($<HTMLInputElement>(root, "#passcode").value);
    if (msg) $(root, "#loginMsg").textContent = msg;
  };
}

/** "Position → 2 reasons → So what" */
const skeleton = (p: ThinkingPattern) =>
  `<div class="pattern" aria-label="${esc(p.skeleton.join(", then "))}">${p.skeleton.map((s) => `<span>${esc(s)}</span>`).join("<i>→</i>")}</div>`;
const example = (p: ThinkingPattern) =>
  `<div class="example"><div class="ex-q">“${esc(p.example.question)}”</div><div>“${esc(p.example.answer)}”</div></div>`;
const patternPanel = (eyebrow: string, p: ThinkingPattern) =>
  `<div class="panel stack" style="gap:8px"><div class="eyebrow">${eyebrow}</div><h3 class="h2">${esc(p.name)}</h3>${skeleton(p)}</div>`;
/**
 * Ready's pattern panel. While the pattern is being introduced: the skeleton and an example. After that only its
 * name; the steps are a tap away, so the learner recalls them first.
 */
const readyPattern = (p: ThinkingPattern, introducing: boolean) => introducing
  ? `<div class="panel stack" style="gap:8px"><div class="eyebrow">Today's thinking pattern</div><h3 class="h2">${esc(p.name)}</h3>${skeleton(p)}${example(p)}</div>`
  : `<details class="panel pattern-fold"><summary><span class="eyebrow">Today's thinking pattern</span><span class="h2">${esc(p.name)}</span><span class="meta">Show the steps</span></summary>
      <div class="stack" style="gap:8px;margin-top:10px">${skeleton(p)}${example(p)}</div></details>`;

const MIC_PHASE: Record<MicCheckPhase, string> = {
  quiet: "Stay quiet for a moment…",
  speech: "Now say one of your Holding phrases out loud, twice.",
  echo: "Now listen: the Partner speaks on your speaker. Stay quiet.",
};
const MIC_VERDICT: Record<MicCheckResult["verdict"], [string, string]> = {
  clear: ["ok", "Clear. The app hears you well, and the Partner's voice doesn't echo back."],
  adjusted: ["ok", "Adjusted for this device. The app now listens at the right level for your mic and room."],
  headphones: ["bad", "The Partner's voice echoes back into your mic. Use headphones for the call, then check again with them on."],
  noisy: ["bad", "It was too noisy while you were meant to stay quiet. Stay silent for that first step, or find a quieter spot, then check again."],
  noSpeech: ["bad", "I didn't hear you. Check that the browser may use the microphone, then try again."],
};
/** Mic RMS shown on a square-root scale, so speech fills most of the meter. */
const meterWidth = (rms: number) => `${Math.round(Math.min(1, Math.sqrt(rms / 0.25)) * 100)}%`;

export interface SetupHandlers {
  /** Starts the mic check; reports the live level and each phase. */
  checkMic(on: { level(rms: number): void; phase(p: MicCheckPhase): void }): Promise<MicCheckResult>;
  save(settings: Settings): void;
  /** Settings only: leave without saving. */
  back?(): void;
}

/**
 * First run (onboarding): how a Session works, the Holding phrases and the mic check. Later (settings): the phrases and
 * the mic check again. Saving needs exactly HOLDING_PHRASE_COUNT phrases.
 */
export function renderSetup(root: HTMLElement, mode: "onboarding" | "settings", settings: Settings, h: SetupHandlers) {
  const picked = new Set(settings.holdingPhrases.filter((id) => HOLDING_PHRASES.some((p) => p.id === id)));
  let turn = settings.turn;
  const intro = mode === "onboarding"
    ? `<div class="stack">
        <div class="onb-hero">
          <div class="eyebrow">Speaking practice · English</div>
          <h1 class="h-display">Say the point first.<br>Then hold it.</h1>
          <p>Ten-minute live calls with a Partner who asks follow-ups the way a senior colleague does. You answer out loud, get one fix, and try again right away.</p>
        </div>
        <div class="panel">
          <div class="eyebrow" style="margin-bottom:6px">How a Session works</div>
          <ol class="flow">
            <li><span class="n">1</span><div><b>A Main question, in meeting tone</b><span>Everyday topics. No specialist knowledge needed.</span></div></li>
            <li><span class="n">2</span><div><b>Two or three Follow-ups</b><span>Why · So what · Counterexample · What would change your mind · Be specific · Have you considered…? · Hostile framing</span></div></li>
            <li><span class="n">3</span><div><b>One Coaching point, then a Redo</b><span>Quoted from your own words. You see a Better version after.</span></div></li>
            <li><span class="n">4</span><div><b>Twice, then one new question</b><span>The last question checks whether the fix carries over.</span></div></li>
          </ol>
          <p class="muted" style="margin:10px 0 0;font-size:13.5px">Pause as long as you need to think. Tap the bulb for a silent Hint if you get stuck.</p>
        </div>
      </div>`
    : `<div><div class="eyebrow">Settings</div><h1 class="h-display" style="font-size:30px;margin-top:6px">Phrases and microphone</h1></div>`;
  root.innerHTML = `<div class="app">${topbar(mode === "settings" ? '<button class="btn ghost small" id="back">Back</button>' : '<span class="meta">Setup</span>')}
    <div class="onb ${mode}">
      ${intro}
      <div class="stack">
        <div class="panel stack" style="gap:12px">
          <div>
            <h2 class="h2">Pick your ${HOLDING_PHRASE_COUNT} Holding phrases</h2>
            <p class="muted" style="margin:4px 0 0;font-size:13.5px">Use one when you need a second to think. It buys time and still says something, unlike “um” or “like”.</p>
          </div>
          <div class="phrases">
            ${HOLDING_PHRASES.map((p) => `<button class="phrase" data-id="${esc(p.id)}" aria-pressed="false"><span>“${esc(p.text)}”</span><span class="tick" aria-hidden="true">✓</span></button>`).join("")}
          </div>
          <div class="meta" id="pickedCount" role="status"></div>
        </div>
        <div class="panel stack" style="gap:10px">
          <h2 class="h2">Microphone check</h2>
          <div class="mic-row"><span class="mic-icon">${icon.mic}</span><div class="meter" aria-hidden="true"><i></i></div><span id="micState" class="mic-state"></span></div>
          <p class="muted" id="micMsg" style="margin:0;font-size:13.5px" role="status"></p>
          <button class="btn ghost block" id="micCheck">Check microphone</button>
        </div>
        <button class="btn primary block" id="save">${mode === "onboarding" ? "Done · go to my first Session" : "Save"}</button>
      </div>
    </div></div>`;

  const save = $<HTMLButtonElement>(root, "#save");
  const refreshPhrases = () => {
    root.querySelectorAll<HTMLButtonElement>(".phrase").forEach((b) => b.setAttribute("aria-pressed", String(picked.has(b.dataset.id!))));
    const n = picked.size;
    $(root, "#pickedCount").textContent = n === HOLDING_PHRASE_COUNT
      ? `${n} of ${HOLDING_PHRASE_COUNT} picked`
      : n < HOLDING_PHRASE_COUNT ? `${n} of ${HOLDING_PHRASE_COUNT} picked · pick ${HOLDING_PHRASE_COUNT - n} more` : `${n} picked · unpick ${n - HOLDING_PHRASE_COUNT}`;
    save.disabled = n !== HOLDING_PHRASE_COUNT;
  };
  root.querySelectorAll<HTMLButtonElement>(".phrase").forEach((b) => {
    b.onclick = () => {
      if (picked.has(b.dataset.id!)) picked.delete(b.dataset.id!);
      else picked.add(b.dataset.id!);
      refreshPhrases();
    };
  });
  refreshPhrases();

  const meter = $(root, ".meter i");
  const micMsg = $(root, "#micMsg");
  const micState = $(root, "#micState");
  const showVerdict = (verdict: MicCheckResult["verdict"] | undefined) => {
    if (!verdict) {
      micState.textContent = "";
      micMsg.textContent = "Checks that the app can hear you, and that the Partner's voice doesn't echo back from your speaker.";
      return;
    }
    const [cls, text] = MIC_VERDICT[verdict];
    micState.className = `mic-state ${cls}`;
    micState.textContent = cls === "ok" ? "Clear" : "Check";
    micMsg.textContent = text;
  };
  showVerdict(turn?.verdict);
  const check = $<HTMLButtonElement>(root, "#micCheck");
  if (turn) check.textContent = "Check again";
  check.onclick = async () => {
    check.disabled = save.disabled = true;
    micState.textContent = "";
    try {
      const r = await h.checkMic({
        level: (rms) => (meter.style.width = meterWidth(rms)),
        phase: (p) => (micMsg.textContent = MIC_PHASE[p]),
      });
      // Nothing heard: keep the levels from before.
      if (r.verdict !== "noSpeech") turn = { speechRms: r.speechRms, bargeInRms: r.bargeInRms, verdict: r.verdict, checkedAt: Date.now() };
      showVerdict(r.verdict);
    } catch (e) {
      micState.className = "mic-state bad";
      micState.textContent = "Check";
      micMsg.textContent = `Couldn't use the microphone: ${(e as Error).message}`;
    }
    meter.style.width = "0";
    check.textContent = "Check again";
    check.disabled = false;
    refreshPhrases();
  };
  save.onclick = () => h.save({ holdingPhrases: HOLDING_PHRASES.filter((p) => picked.has(p.id)).map((p) => p.id), ...(turn ? { turn } : {}) });
  root.querySelector<HTMLButtonElement>("#back")?.addEventListener("click", () => h.back?.());
}

const topActions = '<button class="btn ghost small" id="settings">Settings</button><button class="btn ghost small" id="bank">Questions</button><button class="btn ghost small" id="history">History</button>';
const focusCard = (eyebrow: string, body: string) =>
  `<div class="panel focus-card"><div class="eyebrow">${eyebrow}</div><p>${body}</p></div>`;

/** What Ready offers: the chosen category (null: Random), its Scene and questions, and which categories have any left. */
export interface ReadyChoice {
  category: Category | null;
  questions: SessionQuestions | null;
  open: Record<Category, boolean>;
}

export function renderReady(
  root: HTMLElement, choice: ReadyChoice, nextFocus: string | null, today: { pattern: ThinkingPattern; introduce: boolean },
  h: { call(): void; history(): void; settings(): void; bank(): void; pick(category: Category | null): void },
) {
  const scene = choice.questions?.scene;
  const chip = (label: string, category: Category | null, open: boolean) =>
    `<button class="chip" data-category="${esc(category ?? "")}" aria-pressed="${choice.category === category}"${open ? "" : " disabled"}>${esc(label)}</button>`;
  const anyOpen = CATEGORIES.some((c) => choice.open[c]);
  root.innerHTML = `<div class="app">${topbar(`<div class="top-actions">${topActions}</div>`)}
    <div class="ready">
      ${scene ? `${sceneArt(scene)}<p style="margin:0;font-size:15.5px">${esc(scene.setting)}</p>`
        : `<div class="panel"><p style="margin:0">${anyOpen ? `No unseen questions left in ${esc(choice.category ?? "the bank")}. Pick another category.` : "You've been asked every question in the bank. Review it to bring some back."}</p></div>`}
      ${nextFocus ? focusCard("Next focus · from last time", `<b>${esc(nextFocus)}</b>`) : ""}
      ${readyPattern(today.pattern, today.introduce)}
      <div class="stack" style="gap:8px">
        <div class="eyebrow">Category</div>
        <div class="chips">${chip("Random", null, anyOpen)}${CATEGORIES.map((c) => chip(c, c, choice.open[c])).join("")}</div>
      </div>
      <div class="call-cta">
        <button class="btn primary block" id="call"${scene ? "" : " disabled"}>${icon.phone} Call · about 10 min</button>
        <small>Questions appear as text. What you say stays off-screen.</small>
      </div>
    </div></div>`;
  $<HTMLButtonElement>(root, "#call").onclick = h.call;
  $<HTMLButtonElement>(root, "#history").onclick = h.history;
  $<HTMLButtonElement>(root, "#settings").onclick = h.settings;
  $<HTMLButtonElement>(root, "#bank").onclick = h.bank;
  root.querySelectorAll<HTMLButtonElement>(".chip").forEach((b) => {
    b.onclick = () => h.pick((b.dataset.category || null) as Category | null);
  });
}

const DIFFICULTY_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

/**
 * The Question bank, by category and Scene. The learner strikes out questions they don't want (and can bring them
 * back); questions already asked are marked.
 */
export function renderQuestionBank(root: HTMLElement, { scenes, questions }: QuestionBank, marks: QuestionMarks, h: {
  strike(id: string, struck: boolean): Promise<void>; back(): void;
}) {
  const struck = new Set(marks.struck);
  const seen = new Set(marks.seen);
  const row = (q: BankQuestion) => `<li class="bank-q${struck.has(q.id) ? " struck" : ""}">
      <div><p>${esc(q.text)}</p><span class="meta">${DIFFICULTY_LABEL[q.difficulty]}${seen.has(q.id) ? " · Asked" : ""}</span></div>
      <button class="btn ghost small" data-id="${esc(q.id)}" aria-pressed="${struck.has(q.id)}">${struck.has(q.id) ? "Restore" : "Strike"}</button>
    </li>`;
  const sections = CATEGORIES.map((c) => {
    const inCategory = scenes.filter((s) => s.category === c);
    if (!inCategory.length) return "";
    return `<section class="stack" style="gap:10px"><h2 class="h2">${esc(c)}</h2>${inCategory.map((s) => `<div class="panel stack" style="gap:8px">
        <div class="eyebrow">${esc(s.title)}</div>
        <ul class="bank-list">${questions.filter((q) => q.sceneId === s.id).map(row).join("")}</ul></div>`).join("")}</section>`;
  }).join("");
  const left = questions.filter((q) => !struck.has(q.id) && !seen.has(q.id)).length;
  root.innerHTML = `<div class="app">${topbar('<button class="btn ghost small" id="back">Back</button>')}
    <div class="history">
      <div><div class="eyebrow">Question bank</div><h1 class="h-display">Questions</h1>
        <p class="meta">${questions.length} questions · ${left} not yet asked or struck. Struck questions are never asked.</p></div>
      ${sections}
    </div></div>`;
  $<HTMLButtonElement>(root, "#back").onclick = h.back;
  root.querySelectorAll<HTMLButtonElement>(".bank-q button").forEach((b) => {
    const show = (on: boolean) => {
      b.setAttribute("aria-pressed", String(on));
      b.textContent = on ? "Restore" : "Strike";
      b.closest(".bank-q")!.classList.toggle("struck", on);
    };
    b.onclick = () => {
      const on = b.getAttribute("aria-pressed") !== "true";
      show(on);
      // Not saved: show it as it was, so the screen never claims a strike that won't hold.
      h.strike(b.dataset.id!, on).catch(() => show(!on));
    };
  });
}

// Progress through the Session: two Rounds, then the close. Dots on mobile, a tracker on desktop.
const ROUND_STEPS = ["Main question", "Follow-ups", "Coaching point", "Redo", "Better version"];
const PROGRESS: { group: string; label: string }[] = [
  ...ROUND_STEPS.map((label) => ({ group: "Round 1", label })),
  ...ROUND_STEPS.map((label) => ({ group: "Round 2", label })),
  { group: "Close", label: "Transfer question" },
  { group: "Close", label: "Wrap-up" },
];
function progressIndex(step: Step | null): number {
  if (!step) return -1;
  const inRound = (round: RoundNumber, i: number) => (round - 1) * ROUND_STEPS.length + i;
  switch (step.kind) {
    case "opening": return -1;
    case "main": return inRound(step.round, 0);
    case "followUp": return inRound(step.round, 1);
    case "coaching": return inRound(step.round, 2);
    case "redo": return inRound(step.round, 3);
    case "betterVersion": return inRound(step.round, 4);
    case "transfer": return PROGRESS.length - 2;
    case "wrapUp": return PROGRESS.length - 1;
    case "ended": return PROGRESS.length;
  }
}
/** Where the learner is, in words, for the mobile header. */
function whereLabel(step: Step | null) {
  if (!step || step.kind === "ended") return "";
  if (step.kind === "opening") return "Before we start";
  if ("round" in step) return `Round ${step.round} of 2`;
  return step.kind === "transfer" ? "Transfer question" : "Wrap-up";
}

const DIMENSION: Record<RubricDimension, string> = { directness: "Directness", structure: "Structure", reasoning: "Reasoning" };

const quoteAndFix = (p: CoachingPoint) => `<div>You said <q>${esc(p.quote)}</q></div><div>${esc(p.fix)}</div>`;
const betterCard = (text: string) => `<div class="better-card"><span class="lab">Better version</span><div>${esc(text)}</div></div>`;

const STATUS: Record<CallView["activity"], [string, string, string]> = {
  idle: ["", "Starting…", ""],
  connecting: ["", "Connecting…", "Setting up the call"],
  partnerThinking: ["", "Partner is thinking…", ""],
  partnerSpeaking: ["partner", "Partner is speaking", "You can cut in any time"],
  yourTurn: ["", "Your turn", "Take a moment to think, then answer"],
  reading: ["", "Read the Better version", "Tap Next when you're ready"],
  listening: ["listening", "Listening", "Pause to think. Tap Done when you finish."],
  resuming: ["", "", ""],
  ended: ["", "Call ended", ""],
};

function threadItem(t: ThreadItem) {
  switch (t.kind) {
    case "answer":
      return `<div class="sys">${t.redo ? "Your Redo" : "You answered"} · ${t.seconds} s</div>`;
    case "coaching":
      return `<div class="bubble coach"><div class="who">Partner · Coaching point · ${DIMENSION[t.point.dimension]}</div>
        ${quoteAndFix(t.point)}
        <div class="again">Again: ${esc(t.redoQuestion)}</div></div>`;
    case "betterVersion":
      return betterCard(t.text);
    case "transferComment":
      return `<div class="bubble coach"><div class="who">Partner · On the Transfer question</div><div>${esc(t.text)}</div></div>`;
    case "pattern":
      return `<div class="pattern-card"><div class="eyebrow">Today's pattern · ${esc(t.pattern.name)}</div>${skeleton(t.pattern)}${example(t.pattern)}</div>`;
    case "partner": {
      const label: Record<typeof t.step, string> = {
        opening: "Before we start", main: "Main question", followUp: "", covering: "", redo: "Redo", transfer: "Transfer question", nudge: "", wrapUp: "Wrap-up",
      };
      const who =
        t.step === "followUp" && t.followUpType
          ? `Partner <span class="type-tag">${esc(FOLLOW_UP_LABEL[t.followUpType])}</span>`
          : `Partner${label[t.step] ? ` · ${label[t.step]}` : ""}`;
      return `<div class="bubble"><div class="who">${who}${t.repeat ? " · again" : ""}</div><div class="text">${esc(t.text.trim())}</div></div>`;
    }
  }
}

export interface CallScreen {
  update(view: CallView): void;
}

const hintCard = (hint: NonNullable<CallView["hint"]>) =>
  `<div class="hint-card"><div class="eyebrow">Hint · ${esc(hint.pattern.name)}</div>${skeleton(hint.pattern)}
    ${hint.phrase ? `<div class="meta">Your phrase: “${esc(hint.phrase.text)}”</div>` : ""}</div>`;

/** The desktop reference panel: today's pattern and the learner's phrases, only while the patterns are being introduced. */
const referencePanel = (p: ThinkingPattern, phrases: HoldingPhrase[]) =>
  `${patternPanel("Today's pattern", p)}
  <div class="panel stack" style="gap:8px"><div class="eyebrow">Your holding phrases</div>
    ${phrases.map((x) => `<div style="font-size:14px">“${esc(x.text)}”</div>`).join("")}</div>`;

export function mountCall(root: HTMLElement, scene: Scene, phrases: HoldingPhrase[], h: { done(): void; next(): void; end(): void; hint(): void }): CallScreen {
  const tracker = PROGRESS.map((p, i) => `${p.group !== PROGRESS[i - 1]?.group ? `<li class="grp">${p.group}</li>` : ""}<li data-i="${i}">${p.label}</li>`).join("");
  const dots = PROGRESS.map((p, i) => `${p.group !== PROGRESS[i - 1]?.group ? `${i ? "</span>" : ""}<span class="grp">` : ""}<i data-i="${i}"></i>`).join("") + "</span>";
  root.innerHTML = `<div class="call">
    <aside class="side">
      ${sceneArt(scene)}
      <div><div class="eyebrow">Session · <span class="clock">00:00</span></div><div class="live-dot" style="margin-top:6px">LIVE</div></div>
      <ul class="tracker" aria-label="Session progress">${tracker}</ul>
    </aside>
    <main class="call-main">
      <div class="call-head">${sceneArt(scene)}
        <div style="flex:1;min-width:0"><div class="h2" style="font-size:16px">${esc(scene.title)}</div><div class="meta"><span class="where">Round 1 of 2</span> · <span class="clock">00:00</span></div></div>
        <span class="live-dot">LIVE</span></div>
      <div class="progress" aria-hidden="true">${dots}</div>
      <div class="thread" aria-live="polite"></div>
      <div class="dock">
        <div class="hint-slot" aria-live="polite"></div>
        <div class="status"><div class="wave" aria-hidden="true">${"<i></i>".repeat(7)}</div>
          <div style="flex:1;min-width:0"><b class="st-title"></b><div class="meta st-sub"></div></div></div>
        <div class="dock-row">
          <button class="round-btn hint-btn" id="hint" aria-label="Show hint" aria-pressed="false" disabled>${icon.bulb}</button>
          <button class="btn primary block" id="done" disabled>Done</button>
          <button class="round-btn" id="end" aria-label="End call">${icon.end}</button>
        </div>
      </div>
    </main>
    <aside class="side right">
      <div class="reference"></div>
      <div class="panel" style="display:grid;gap:8px"><div class="eyebrow">The setting</div><div style="font-size:14px">${esc(scene.setting)}</div></div>
      <div class="panel" style="display:grid;gap:8px"><div class="eyebrow">How turns work</div>
        <div style="font-size:14px">Pause as long as you need. Your turn ends after a few seconds of quiet, or when you tap Done. You can cut in while the Partner talks.</div></div>
    </aside>
  </div>`;
  let canNext = false;
  // One button: Done while the learner answers, Next while they read the Better version.
  $<HTMLButtonElement>(root, "#done").onclick = () => (canNext ? h.next() : h.done());
  $<HTMLButtonElement>(root, "#end").onclick = h.end;
  $<HTMLButtonElement>(root, "#hint").onclick = h.hint;
  const thread = $(root, ".thread");
  let startedAt: number | null = null;
  let lastActivity: CallView["activity"] = "idle";
  let shownReference: string | null = null;

  const tick = () => {
    if (startedAt === null) return;
    root.querySelectorAll(".clock").forEach((c) => (c.textContent = fmtClock(Date.now() - startedAt!)));
  };
  const timer = setInterval(tick, 1000);

  return {
    update(view) {
      startedAt = view.startedAt;
      tick();
      const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
      thread.innerHTML = view.thread.map(threadItem).join("");
      if (atBottom) thread.scrollTop = thread.scrollHeight;

      const at = progressIndex(view.step);
      root.querySelectorAll<HTMLElement>(".progress i, .tracker li[data-i]").forEach((el) => {
        const i = Number(el.dataset.i);
        el.classList.toggle("done", i < at);
        el.classList.toggle("now", i === at);
      });
      if (view.step?.kind === "followUp") {
        const li = root.querySelector(`.tracker li[data-i="${at}"]`);
        if (li) li.textContent = `Follow-ups · ${view.step.n}`;
      }
      const where = whereLabel(view.step);
      if (where) $(root, ".where").textContent = where;

      // A connection swap should go unnoticed: keep the last status and only note it.
      const activity = view.activity === "resuming" ? lastActivity : view.activity;
      lastActivity = activity;
      const [cls, title, sub] = STATUS[activity];
      $(root, ".status").className = `status ${cls}`;
      $(root, ".st-title").textContent = title;
      $(root, ".st-sub").textContent = view.activity === "resuming" ? "Reconnecting…" : sub;
      canNext = view.canNext;
      const button = $<HTMLButtonElement>(root, "#done");
      button.textContent = canNext ? "Next" : "Done";
      button.disabled = !view.canDone && !view.canNext;
      $<HTMLButtonElement>(root, "#end").disabled = view.activity === "ended";

      const hintButton = $<HTMLButtonElement>(root, "#hint");
      hintButton.disabled = !view.pattern || view.activity === "ended";
      hintButton.setAttribute("aria-pressed", String(!!view.hint));
      hintButton.setAttribute("aria-label", view.hint ? "Hide hint" : "Show hint");
      $(root, ".hint-slot").innerHTML = view.hint ? hintCard(view.hint) : "";
      // Hint fading: once every pattern has been introduced, the pattern lives only behind the Hint button.
      const reference = view.pattern?.introducing ? view.pattern.pattern.id : "";
      if (reference !== shownReference) {
        shownReference = reference;
        $(root, ".reference").innerHTML = view.pattern?.introducing ? referencePanel(view.pattern.pattern, phrases) : "";
      }
      if (view.activity === "ended") {
        clearInterval(timer);
        root.querySelectorAll(".live-dot").forEach((d) => d.classList.add("hidden"));
      }
    },
  };
}

const END_REASON: Record<SessionRecord["endReason"], string> = {
  complete: "Session complete",
  timeCap: "Time's up: the Partner wrapped up",
  userEnded: "You ended the call",
  connectionLost: "The connection dropped",
};

const fmtDate = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "Why ×2, So what" */
function followUpCounts(types: FollowUpType[]) {
  const counts = new Map<FollowUpType, number>();
  types.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  return [...counts].map(([t, n]) => `${FOLLOW_UP_LABEL[t]}${n > 1 ? ` ×${n}` : ""}`).join(", ");
}

function roundCard(r: SessionRecord["rounds"][number], n: number) {
  const point = r.coachingPoint;
  const redo = r.redoSeconds === undefined
    ? ""
    : `<div class="yours"><span class="lab">Your Redo · ${r.redoSeconds} s</span>${r.redo ? esc(r.redo) : '<span class="muted">(not transcribed)</span>'}</div>`;
  const better = r.betterVersion ? `<div class="better"><span class="lab">Better version</span>${esc(r.betterVersion)}</div>` : "";
  return `<div class="panel round-card">
      <div class="eyebrow">Round ${n}${point ? ` · Coaching point · ${DIMENSION[point.dimension]}` : ""}</div>
      <div class="q">${esc(r.mainQuestion)}</div>
      ${point ? `<div class="point">${quoteAndFix(point)}</div>` : '<div class="muted">No Coaching point this Round.</div>'}
      ${redo || better ? `<div class="compare">${redo}${better}</div>` : ""}
    </div>`;
}

/** A small line of recent Sessions' values, oldest first; the latest is the emphasised dot. */
function sparkline(values: number[], label: string) {
  const W = 96, H = 28, P = 4;
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (i: number) => (values.length < 2 ? W - P : P + (i * (W - 2 * P)) / (values.length - 1));
  const y = (v: number) => (hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
      ${values.length > 1 ? `<polyline points="${points}" fill="none" stroke="var(--muted)" stroke-opacity="0.45" stroke-width="1.5" stroke-linejoin="round"/>` : ""}
      ${values.slice(0, -1).map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2" fill="var(--muted)"/>`).join("")}
      <circle cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/>
    </svg>`;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const perMin = (v: number) => `${v.toFixed(1)}/min`;

/** The three metrics on the summary (Answer length and the counts are under Details). */
const METRIC_ROWS: { metric: TrendMetric; name: string; note: string; show(m: SessionMetrics): string | null; unit(v: number): string }[] = [
  {
    metric: "answerFirst", name: "Answer in the first sentence", note: "Answers that opened with your call",
    show: (m) => (m.answerFirst ? `${m.answerFirst.yes}/${m.answerFirst.of}` : null),
    unit: pct,
  },
  {
    metric: "responseLatency", name: "Response latency", note: "to your first word of substance",
    show: (m) => (m.responseLatencyMs === undefined ? null : secs(m.responseLatencyMs)),
    unit: secs,
  },
  { metric: "fillerRate", name: "Filler rate", note: "um, uh, like, you know…", show: (m) => perMin(m.fillersPerMinute), unit: perMin },
];

/** One sentence on the biggest change against the learner's recent Sessions. */
function headline(m: SessionMetrics, insights: MetricInsight[]): string {
  if (insights.every((i) => i.change === "first")) return "Your first measured Session. These are your starting points.";
  const top = headlineInsight(insights);
  if (!top) return "About the same as your recent Sessions.";
  const avg = top.average!;
  const best = top.best ? ", your best so far" : "";
  const af = m.answerFirst!;
  if (top.change === "better") {
    if (top.metric === "answerFirst") return `${af.yes} of ${af.of} Answers opened with your call${best || `, up from ${pct(avg)} recently`}.`;
    if (top.metric === "responseLatency") return `You started answering sooner: ${secs(top.value)}, down from ${secs(avg)}${best}.`;
    return `Fewer fillers: ${perMin(top.value)}, down from ${perMin(avg)}${best}.`;
  }
  if (top.metric === "answerFirst") return `Fewer Answers opened with your call: ${af.yes} of ${af.of}, down from ${pct(avg)} recently.`;
  // Lesson 0001: a Holding phrase buys time while already saying something. Lesson 0002: pause silently instead of "um".
  if (top.metric === "responseLatency") return `You took longer to start: ${secs(top.value)}, up from ${secs(avg)}. A Holding phrase gets you talking sooner.`;
  return `More fillers: ${perMin(top.value)}, up from ${perMin(avg)}. A silent pause works better than "um".`;
}

/** "↓ from 10.1 s avg", coloured by whether that is better. */
function comparison(i: MetricInsight, unit: (v: number) => string) {
  if (i.change === "first") return '<span class="metric-cmp">first measured</span>';
  if (i.change === "same") return '<span class="metric-cmp">≈ your average</span>';
  const arrow = i.value < i.average! ? "↓" : "↑";
  return `<span class="metric-cmp ${i.change}">${arrow} from ${unit(i.average!)} avg</span>`;
}

/**
 * Answer in the first sentence, Response latency and Filler rate: each against the learner's recent average, with its
 * trend, under one sentence on the biggest change. measuring: still being worked out; history: every saved Session.
 */
function metricsPanel(record: SessionRecord, history: SessionRecord[], measuring: boolean) {
  const m = record.metrics;
  const empty = (text: string) => `<div class="panel metrics"><div class="eyebrow">Speech metrics</div><div class="muted">${text}</div></div>`;
  if (!m) {
    if (measuring) return empty("Measuring your Answers…");
    if (record.metricsUnavailable) return empty("This Session's Answers couldn't be transcribed, so it has no metrics.");
    if (record.metricsPending) return empty("Some Answers couldn't be transcribed yet. It tries again next time you open the app.");
    return "";
  }
  const shown = METRIC_ROWS.flatMap((row) => {
    const value = row.show(m);
    const i = value === null ? null : insight(history, record, row.metric);
    return value !== null && i ? [{ row, value, i }] : [];
  });
  const rows = shown.map(({ row, value, i }) => {
    const values = trend(history, record, row.metric);
    const label = `${row.name} over the last ${values.length} Session${values.length === 1 ? "" : "s"}: ${values.map(row.unit).join(", ")}`;
    return `<div class="metric"><div class="metric-name"><span>${esc(row.name)}</span><span class="metric-note">${esc(row.note)}</span>${comparison(i, row.unit)}</div>
        ${sparkline(values, label)}<b class="metric-value">${esc(value)}</b></div>`;
  }).join("");
  return `<div class="panel metrics"><div class="eyebrow">Speech metrics</div>
      <p class="metric-headline">${esc(headline(m, shown.map((x) => x.i)))}</p>${rows}</div>`;
}

/** Everything else the Session counted, folded away. */
function detailsPanel(record: SessionRecord) {
  const t = record.transfer;
  const answers = record.rounds.flatMap((r) => r.answerSeconds).concat(t?.answerSeconds ?? []);
  const followUps = record.rounds.flatMap((r) => r.followUpTypes);
  const m = record.metrics;
  const kv = (k: string, v: string) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
  return `<details class="panel sum-details"><summary>Details</summary>
      ${m ? kv("Answer length", `${Math.round(m.answerSeconds)} s on average`) : ""}
      ${kv("Answers", String(answers.length))}
      ${kv("Time answering", `${answers.reduce((a, b) => a + b, 0)} s`)}
      ${m ? kv("Holding phrases used", String(m.holdingPhrases)) : ""}
      ${kv("Follow-up types faced", esc(followUpCounts(followUps)) || "–")}
      ${record.thinkingPattern && patternById(record.thinkingPattern) ? kv("Thinking pattern", esc(patternById(record.thinkingPattern)!.name)) : ""}
      ${record.hintUses !== undefined ? kv("Hints used", String(record.hintUses)) : ""}
    </details>`;
}

/**
 * The Session's summary: the Next focus and the speech metrics first (what to practise, and whether it's working),
 * then each Round's Coaching point with the Redo next to the Better version, the Transfer question, and the counts
 * folded under Details. pending: the Next focus may still come. measuring: the metrics may still come. history: every
 * saved Session, for the trends.
 */
export function renderSummary(root: HTMLElement, record: SessionRecord, opts: {
  pending: boolean; measuring: boolean; history: SessionRecord[]; sceneTitle: string; backLabel: string; back(): void;
}) {
  const t = record.transfer;
  const transfer = t
    ? `<div class="panel round-card"><div class="eyebrow">Transfer question</div>
        <div class="q">${esc(t.question)}</div>
        ${t.comment ? `<div>${esc(t.comment)}</div>` : `<div class="muted">${t.answerSeconds === undefined ? "Not answered." : "No comment this time."}</div>`}</div>`
    : "";
  const focus = record.nextFocus
    ? focusCard("Next focus · for next time", `<b>${esc(record.nextFocus)}</b>`)
    : focusCard("Next focus", `<span class="muted">${opts.pending ? "Preparing your Next focus…" : "No Next focus from this Session."}</span>`);
  root.innerHTML = `<div class="app">${topbar(`<span class="meta">${esc(fmtDate(record.startedAt))} · ${fmtClock(record.endedAt - record.startedAt)}</span>`)}
    <div class="sum">
      <div class="sum-head"><div class="eyebrow">${esc(opts.sceneTitle)}</div><h1 class="h-display">${END_REASON[record.endReason]}</h1></div>
      <div class="stack sum-side">
        ${focus}
        ${metricsPanel(record, opts.history, opts.measuring)}
      </div>
      <div class="stack sum-rounds">
        ${record.rounds.map((r, i) => roundCard(r, i + 1)).join("")}
        ${transfer}
        ${detailsPanel(record)}
        <button class="btn primary block" id="back">${esc(opts.backLabel)}</button>
      </div>
    </div></div>`;
  $<HTMLButtonElement>(root, "#back").onclick = opts.back;
}

/** A delete button that asks for a second tap before it acts. */
function confirmTwice(button: HTMLButtonElement, confirmLabel: string, act: () => void) {
  const label = button.textContent;
  let armed: ReturnType<typeof setTimeout> | null = null;
  button.onclick = (e) => {
    e.stopPropagation();
    if (armed) {
      clearTimeout(armed);
      return act();
    }
    button.textContent = confirmLabel;
    button.classList.add("armed");
    armed = setTimeout(() => {
      armed = null;
      button.textContent = label;
      button.classList.remove("armed");
    }, 4000);
  };
}

/** Past Sessions (given oldest first), shown newest first. Each can be opened or deleted; everything can be deleted at once. */
export function renderHistory(root: HTMLElement, sessions: SessionRecord[], h: {
  sceneTitle(id: string): string; open(record: SessionRecord): void; remove(id: string): void; removeAll(): void; back(): void;
}) {
  const newest = [...sessions].reverse();
  const rows = newest.map((r) => `<li class="hist-row">
      <button class="hist-open" data-id="${esc(r.id)}">
        <span class="meta">${esc(fmtDate(r.startedAt))} · ${fmtClock(r.endedAt - r.startedAt)}</span>
        <b>${esc(h.sceneTitle(r.sceneId))} · ${END_REASON[r.endReason]}</b>
        ${r.nextFocus ? `<span class="muted">Next focus: ${esc(r.nextFocus)}</span>` : ""}
      </button>
      <button class="btn ghost small hist-del" data-id="${esc(r.id)}" aria-label="Delete this Session">Delete</button>
    </li>`).join("");
  root.innerHTML = `<div class="app">${topbar('<button class="btn ghost small" id="back">Back</button>')}
    <div class="history">
      <div><div class="eyebrow">History</div><h1 class="h-display">Past Sessions</h1>
        <p class="meta">Saved on this device only.</p></div>
      ${newest.length ? `<ul class="hist-list">${rows}</ul>
        <button class="btn ghost block danger" id="deleteAll">Delete all Sessions</button>` : '<p class="muted">No Sessions yet.</p>'}
    </div></div>`;
  $<HTMLButtonElement>(root, "#back").onclick = h.back;
  root.querySelectorAll<HTMLButtonElement>(".hist-open").forEach((b) => {
    b.onclick = () => h.open(newest.find((r) => r.id === b.dataset.id)!);
  });
  root.querySelectorAll<HTMLButtonElement>(".hist-del").forEach((b) => confirmTwice(b, "Tap to delete", () => h.remove(b.dataset.id!)));
  const all = root.querySelector<HTMLButtonElement>("#deleteAll");
  if (all) confirmTwice(all, `Tap again to delete all ${newest.length}`, h.removeAll);
}
