// LiveAdapter over the Gemini Live API. Owns the audio path (capture → turn detection → upload, Partner audio →
// playback) and the connection: a proactive swap at 8.5 min at a quiet moment, and resumption after any close.
// The engine only ever sees "resuming" / "resumed".
import type { LiveAdapter, LiveEvent, TurnEndedBy } from "../../engine/types";
import { startCapture, type MicFrame } from "../audio/capture";
import { Playback } from "../audio/playback";
import type { Log } from "../debug-log";
import { DEFAULT_TURN_SETTINGS, TurnDetector, type TurnSettings } from "./turn-detector";
import { LiveUsage, type UsageMetadata } from "./usage";

const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
/** The server cuts a connection at ~600 s with 1011 and no goAway, so swap well before that. */
const DEFAULT_SWAP_AFTER_MS = 510_000;
/** If no quiet moment comes, swap anyway this long after the swap fell due. */
const FORCE_SWAP_AFTER_MS = 60_000;
/** Reconnecting right after a close fails with 1011; waiting this long works. */
const RECONNECT_DELAY_MS = 800;
const RESUME_TRIES = 5;
const HEALTH_EVERY_MS = 30_000;
/**
 * The server can stop answering a session altogether: a reply starts and never finishes, and nothing comes after it,
 * even on a resumed connection (seen on workers.dev 2026-10-07). A Partner turn whose audio has played out with nothing
 * from the server for this long is stalled...
 */
const STALLED_TURN_MS = 6000;
/** ...and so is a reply asked for this long ago with nothing from the server since. */
const NO_REPLY_MS = 6000;

export interface GeminiLiveOptions {
  ctx: AudioContext;
  /** The real mic or the test fake mic. */
  micSource: AudioNode;
  log: Log;
  swapAfterMs?: number;
  turn?: TurnSettings;
  /** Test-only (?simulateStall=90): from this long after connecting, drop every server message until a fresh session. */
  simulateStallAfterMs?: number;
}

interface TokenInfo { token: string; model: string }

interface ServerMessage {
  setupComplete?: unknown;
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: UsageMetadata;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    modelTurn?: { parts?: { inlineData?: { data: string; mimeType: string } }[] };
    outputTranscription?: { text?: string };
    inputTranscription?: { text?: string };
  };
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A text message from the app to the Partner. turnComplete: speak now; otherwise it waits for the learner. */
const textTurn = (text: string, turnComplete: boolean) => ({
  clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete },
});

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function concat(chunks: ArrayBuffer[]) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(new Uint8Array(c), at);
    at += c.byteLength;
  }
  return out.buffer;
}

export class GeminiLive implements LiveAdapter {
  private readonly ctx: AudioContext;
  private readonly log: Log;
  private readonly swapAfterMs: number;
  private readonly listeners = new Set<(e: LiveEvent) => void>();
  private readonly playback: Playback;
  private readonly turns: TurnDetector;
  private stopCapture: (() => void) | undefined;
  /** Everything sent for the open learner turn, handed to the engine for transcription when it closes. */
  private recording: ArrayBuffer[] = [];

  private token: TokenInfo | null = null;
  private ws: WebSocket | null = null;
  private handle: string | null = null;
  private resumable = false;
  private connections = 0;
  private closed = false;
  private reconnecting = false;
  private swapDue = false;
  private swapTimers: ReturnType<typeof setTimeout>[] = [];
  /** Messages sent while no connection is open; flushed on (re)connect. */
  private queue: string[] = [];

  /** The latest standing instruction for the Partner's next reply; re-sent after a resume until consumed. */
  private standingReply: string | null = null;
  /** A learner turn has closed (or the Partner was told to speak) and its reply hasn't finished. */
  private replyPending = false;
  private partnerTurn = false;
  private generationDone = false;
  /** A learner turn closed and the Partner's automatic reply to it hasn't started. */
  private awaitingAutoReply = false;
  /** The Partner's turn lost its end in a reconnect; the engine has it said again. */
  private cutByReconnect = false;
  /** The latest speak() whose Partner turn hasn't started: sent again when a stalled session is recovered. */
  private pendingSpeak: string | null = null;
  /** When the server last sent content, and when the pending reply was asked for. */
  private lastServerAt = 0;
  private replyAskedAt = 0;
  /** Stalls recovered without the server answering in between: the first resumes, the next starts a fresh session. */
  private stalls = 0;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private readonly simulateStallAfterMs: number | undefined;
  private simulatingStall = false;
  /** The engine is about to have the Partner speak: no proactive swap now (a forced one still happens). */
  private swapHeld = false;

  // Diagnostics
  private turnClosedAt = 0;
  private closedBy: TurnEndedBy = "silence";
  private partnerAudioEndedAt = 0;
  private partnerTurnStartedAt = 0;
  private maxRmsWhilePartner = 0;
  private partnerText = "";
  private learnerText = "";
  private frames = 0;
  private health: { at: number; audioTime: number; frames: number } | null = null;
  private healthTimer: ReturnType<typeof setInterval> | undefined;
  private usage = new LiveUsage();

  constructor(opts: GeminiLiveOptions) {
    this.ctx = opts.ctx;
    this.log = opts.log;
    this.swapAfterMs = opts.swapAfterMs ?? DEFAULT_SWAP_AFTER_MS;
    this.simulateStallAfterMs = opts.simulateStallAfterMs;
    this.playback = new Playback(this.ctx, () => this.onPlaybackIdle());
    this.turns = new TurnDetector(opts.turn ?? DEFAULT_TURN_SETTINGS, {
      open: (preroll, rms, bargeIn) => this.onTurnOpen(preroll, rms, bargeIn),
      audio: (pcm) => {
        this.recording.push(pcm);
        this.sendAudio(pcm);
      },
      close: (by, speechMs) => this.onTurnClose(by, speechMs),
    });
    const t = opts.turn ?? DEFAULT_TURN_SETTINGS;
    this.log(`turn settings: speech ${t.speechRms} · barge-in ${t.bargeInRms} · silence ${t.silenceMs} ms · swap after ${this.swapAfterMs / 1000} s`);
    void startCapture(this.ctx, opts.micSource, (f) => this.onMic(f)).then((stop) => {
      if (this.closed) stop();
      else this.stopCapture = stop;
    }, (e) => this.log(`capture failed: ${(e as Error).message}`));
  }

  subscribe(listener: (e: LiveEvent) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(e: LiveEvent) {
    this.listeners.forEach((l) => l(e));
  }

  // ---------- LiveAdapter commands ----------

  async connect() {
    await this.mintToken();
    await this.open(null);
    this.lastServerAt = performance.now();
    this.healthTimer = setInterval(() => this.logHealth(), HEALTH_EVERY_MS);
    this.watchdog = setInterval(() => this.checkStall(), 1000);
    if (this.simulateStallAfterMs) {
      setTimeout(() => { this.log("TEST: simulating a stalled server until a fresh session"); this.simulatingStall = true; }, this.simulateStallAfterMs);
    }
  }

  /** The ephemeral token is single-use; resuming doesn't use it up, but a fresh session needs a new one. */
  private async mintToken() {
    const r = await fetch("/api/token", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`token: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    this.token = j as TokenInfo;
    this.log(`token minted for ${this.token.model}`);
  }

  speak(instruction: string) {
    this.log(`→ speak: ${instruction}`);
    this.askReply();
    this.pendingSpeak = instruction;
    this.send(textTurn(instruction, true));
  }

  private askReply() {
    if (!this.replyPending) this.replyAskedAt = performance.now();
    this.replyPending = true;
  }

  setNextReply(instruction: string) {
    this.log(`→ next reply: ${instruction}`);
    this.standingReply = instruction;
    this.send(textTurn(instruction, false));
  }

  endLearnerTurn() {
    this.turns.close("done", performance.now());
  }

  addContext(text: string) {
    this.log(`→ context: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
    this.send(textTurn(text, false));
  }

  holdSwap(hold: boolean) {
    if (hold === this.swapHeld) return;
    this.swapHeld = hold;
    if (this.swapDue) this.log(hold ? "swap held: the engine is about to speak" : "swap hold released");
    if (!hold) this.maybeSwap();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.logHealth();
    this.log(`call closed · ${this.usageSummary()}`);
    this.swapTimers.forEach(clearTimeout);
    clearInterval(this.healthTimer);
    clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      try { ws.close(1000, "end"); } catch { /* already closed */ }
    }
    this.playback.stop();
    this.turns.reset();
    this.stopCapture?.();
    this.queue = [];
  }

  // ---------- connection ----------

  /** Opens a connection, resuming the session when given a handle. Resolves on setupComplete. */
  private open(handle: string | null, fresh = false): Promise<void> {
    const token = this.token!;
    const opened = performance.now();
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(token.token)}`);
      sock.binaryType = "arraybuffer";
      let settled = false;
      sock.onopen = () =>
        sock.send(JSON.stringify({ setup: { model: `models/${token.model}`, sessionResumption: handle ? { handle } : {} } }));
      sock.onmessage = (ev) => {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)) as ServerMessage;
        if (msg.setupComplete !== undefined && !settled) {
          settled = true;
          this.connections++;
          this.ws = sock;
          this.log(`setupComplete in ${Math.round(performance.now() - opened)} ms (connection #${this.connections}${handle ? ", resumed" : ""})`);
          this.scheduleSwap(sock);
          this.flush(fresh ? "fresh" : handle !== null ? "resumed" : "first");
          resolve();
          return;
        }
        if (sock !== this.ws || this.simulatingStall) return;
        if (msg.serverContent) {
          this.lastServerAt = performance.now();
          this.stalls = 0;
        }
        this.onServer(msg);
      };
      sock.onerror = () => this.log("ws error");
      sock.onclose = (ev) => {
        this.log(`ws closed code=${ev.code} reason=${ev.reason || "-"}`);
        if (!settled) {
          settled = true;
          reject(new Error(`closed before setup: ${ev.code} ${ev.reason}`));
          return;
        }
        if (sock === this.ws && !this.closed && !this.reconnecting) {
          this.log("unexpected close → resuming");
          this.ws = null;
          void this.resume("unexpected close");
        }
      };
    });
  }

  private flush(how: "first" | "resumed" | "fresh") {
    const ws = this.ws!;
    if (how === "fresh") {
      // A new session has heard nothing: the engine briefs it and asks again for what was pending (resumed, fresh).
      // Replaying the queue here would make the Partner reply before it knows the call.
      if (this.queue.length) this.log(`dropping ${this.queue.length} queued messages for the fresh session`);
      this.queue = [];
      this.standingReply = null;
      this.pendingSpeak = null;
      if (this.turns.isOpen) ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
      return;
    }
    if (how === "resumed") {
      // A turn that was open when the old connection dropped must be reopened here.
      if (this.turns.isOpen && !this.queue.some((m) => m.includes('"activityStart"'))) {
        ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
      }
      // The standing note may not have made it into the resumed context. Sending it twice is harmless. If the learner
      // had finished and the reply was lost with the old connection, nothing would ever come: ask for it now.
      // Only when the learner's activityEnd already reached the old connection: one still in the queue triggers the
      // reply itself, and asking as well would make the Partner reply twice (ADR-0002).
      if (this.standingReply) {
        const now = this.awaitingAutoReply && !this.turns.isOpen && !this.queue.some((m) => m.includes('"activityEnd"'));
        ws.send(JSON.stringify(textTurn(this.standingReply, now)));
        this.log(`re-sent the standing next-reply note after resume${now ? " (reply was lost: reply now)" : ""}`);
      }
      // A line the Partner was told to say and never started went with the old connection (or a stuck session).
      if (this.pendingSpeak && !this.partnerTurn && !this.queue.some((m) => m.includes(JSON.stringify(this.pendingSpeak)))) {
        ws.send(JSON.stringify(textTurn(this.pendingSpeak, true)));
        this.log("re-sent the line the Partner hadn't started");
      }
    }
    if (this.queue.length) this.log(`flushing ${this.queue.length} queued messages`);
    for (const m of this.queue) ws.send(m);
    this.queue = [];
  }

  private scheduleSwap(sock: WebSocket) {
    this.swapTimers.forEach(clearTimeout);
    this.swapDue = false;
    this.swapTimers = [
      setTimeout(() => {
        if (sock !== this.ws || this.closed) return;
        this.log(`connection is ${this.swapAfterMs / 1000} s old → swapping at the next quiet moment`);
        this.swapDue = true;
        this.swapTimers.push(setTimeout(() => this.swapDue && sock === this.ws && void this.resume("forced swap"), FORCE_SWAP_AFTER_MS));
        this.maybeSwap();
      }, this.swapAfterMs),
    ];
  }

  /** Swap only when nothing is in flight: no Partner audio, no learner turn, no reply pending. */
  private maybeSwap() {
    if (
      this.swapDue && this.resumable && this.handle && !this.reconnecting && !this.closed && !this.swapHeld &&
      !this.replyPending && !this.partnerTurn && !this.playback.playing && !this.turns.isOpen
    ) void this.resume("swap");
  }

  /** Watchdog: recovers a session the server has stopped answering. */
  private checkStall() {
    if (this.closed || this.reconnecting || !this.ws) return;
    const now = performance.now();
    const silentFor = now - this.lastServerAt;
    const turnStalled = this.partnerTurn && !this.generationDone && !this.playback.playing && silentFor > STALLED_TURN_MS;
    const replyLost = this.replyPending && !this.partnerTurn && !this.turns.isOpen &&
      now - this.replyAskedAt > NO_REPLY_MS && silentFor > NO_REPLY_MS;
    if (!turnStalled && !replyLost) return;
    this.stalls++;
    const why = turnStalled ? `Partner turn stalled (${Math.round(silentFor)} ms with nothing from the server)` : `no reply for ${Math.round(now - this.replyAskedAt)} ms`;
    // A resume often brings back the same stuck session; then only a fresh one helps.
    this.log(`STALL: ${why} → ${this.stalls > 1 ? "fresh session" : "resuming"}`);
    void this.resume(why, this.stalls > 1);
  }

  /**
   * Close the old connection, wait, then reconnect with the latest handle. Opening the new one first fails.
   * fresh: a new session instead (new token, no handle). The Partner then has no memory of the call so far.
   */
  private async resume(why: string, fresh = false) {
    if (this.reconnecting || this.closed) return;
    if (!this.handle && !fresh) {
      this.log(`cannot resume (${why}): no resumption handle yet`);
      this.emit({ type: "connectionLost" });
      return;
    }
    this.reconnecting = true;
    this.swapDue = false;
    this.swapTimers.forEach(clearTimeout);
    const started = performance.now();
    this.emit({ type: "resuming" });
    if (this.partnerTurn && !this.generationDone) {
      // The rest of this reply went with the old connection, and no turnComplete will come for it: the turn ends when
      // what already arrived has played.
      this.log("Partner reply cut by the reconnect");
      this.generationDone = true;
      this.replyPending = false;
      this.cutByReconnect = true;
      if (!this.playback.playing) this.endPartnerTurn(false);
    }
    const old = this.ws;
    this.ws = null;
    if (old && old.readyState <= WebSocket.OPEN) {
      await new Promise<void>((r) => {
        old.onclose = () => r();
        try { old.close(1000, "resume"); } catch { r(); }
        setTimeout(r, 2000);
      });
    }
    await sleep(RECONNECT_DELAY_MS);
    for (let i = 1; i <= RESUME_TRIES && !this.closed; i++) {
      try {
        if (fresh) {
          await this.mintToken();
          this.handle = null;
          this.resumable = false;
          this.simulatingStall = false;
        }
        await this.open(fresh ? null : this.handle, fresh);
        this.log(`${fresh ? "fresh session" : "resumed"} (${why}) on try ${i}, gap ${Math.round(performance.now() - started)} ms`);
        this.reconnecting = false;
        this.lastServerAt = performance.now();
        if (this.replyPending) this.replyAskedAt = performance.now();
        this.emit(fresh ? { type: "resumed", fresh } : { type: "resumed" });
        return;
      } catch (e) {
        this.log(`resume try ${i} failed: ${(e as Error).message}`);
        await sleep(500 * i);
      }
    }
    this.reconnecting = false;
    if (!this.closed) {
      this.log("RESUME GAVE UP");
      this.emit({ type: "connectionLost" });
    }
  }

  private send(msg: object) {
    const s = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  private sendAudio(pcm: ArrayBuffer) {
    this.send({ realtimeInput: { audio: { data: toBase64(pcm), mimeType: "audio/pcm;rate=16000" } } });
  }

  // ---------- learner side ----------

  private onMic(f: MicFrame) {
    this.frames++;
    if (this.closed) return;
    const partnerAudible = this.playback.playing;
    if (partnerAudible) this.maxRmsWhilePartner = Math.max(this.maxRmsWhilePartner, f.rms);
    this.turns.frame(f, partnerAudible, performance.now());
  }

  private onTurnOpen(preroll: ArrayBuffer[], rms: number, bargeIn: boolean) {
    const now = performance.now();
    const after = this.partnerAudioEndedAt && !bargeIn ? ` · ${((now - this.partnerAudioEndedAt) / 1000).toFixed(1)} s after Partner audio ended` : "";
    this.log(`▶ learner turn opens (rms ${rms.toFixed(3)})${bargeIn ? " — BARGE-IN over Partner" : ""}${this.replyPending && !this.partnerTurn ? " — while a reply was pending" : ""}${after}`);
    if (this.partnerTurn) {
      // Don't wait for the server's `interrupted`; cut the Partner off now.
      this.playback.stop();
      this.endPartnerTurn(true);
    }
    this.replyPending = false;
    this.awaitingAutoReply = false;
    this.emit({ type: "learnerTurnStarted" });
    this.send({ realtimeInput: { activityStart: {} } });
    preroll.forEach((p) => this.sendAudio(p));
    this.recording = [...preroll];
  }

  private onTurnClose(by: TurnEndedBy, speechMs: number) {
    this.turnClosedAt = performance.now();
    this.closedBy = by;
    this.askReply();
    this.awaitingAutoReply = true;
    this.send({ realtimeInput: { activityEnd: {} } });
    this.log(`■ learner turn closes by ${by.toUpperCase()} · speech ${(speechMs / 1000).toFixed(1)} s`);
    const audio = concat(this.recording);
    this.recording = [];
    this.emit({ type: "learnerTurnEnded", speechMs, by, audio });
  }

  // ---------- Partner side ----------

  private onServer(msg: ServerMessage) {
    if (msg.usageMetadata) this.usage.add(msg.usageMetadata);
    if (msg.goAway) {
      this.log(`goAway timeLeft=${msg.goAway.timeLeft}`);
      this.swapDue = true;
      const secs = parseFloat(msg.goAway.timeLeft ?? "0") || 0;
      this.swapTimers.push(setTimeout(() => this.swapDue && void this.resume("goAway deadline"), Math.max(0, (secs - 4) * 1000)));
      this.maybeSwap();
    }
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      this.resumable = !!u.resumable;
      if (u.resumable && u.newHandle) this.handle = u.newHandle;
      this.maybeSwap();
    }
    const sc = msg.serverContent;
    if (!sc) return;
    if (sc.inputTranscription?.text) this.learnerText += sc.inputTranscription.text;
    if (sc.interrupted) {
      this.log(`server: interrupted (learner turn open=${this.turns.isOpen})`);
      this.playback.stop();
      this.endPartnerTurn(true);
      return;
    }
    // With manual turn-taking the Partner can't reply while the learner's turn is open, so anything arriving now is
    // the tail of a reply the learner cut off (it can come after `interrupted`). Drop it.
    if (this.turns.isOpen) return;
    for (const p of sc.modelTurn?.parts ?? []) {
      if (p.inlineData?.data && p.inlineData.mimeType?.startsWith("audio/pcm")) {
        this.startPartnerTurn();
        this.playback.enqueue(p.inlineData.data, p.inlineData.mimeType);
      }
    }
    if (sc.outputTranscription?.text) {
      this.startPartnerTurn();
      this.partnerText += sc.outputTranscription.text;
      this.emit({ type: "partnerText", text: sc.outputTranscription.text });
    }
    if (sc.turnComplete) {
      this.generationDone = true;
      this.replyPending = false;
      this.pendingSpeak = null;
      if (!this.partnerTurn) this.log("server: turnComplete with no Partner audio");
      else if (!this.playback.playing) this.endPartnerTurn(false);
      this.maybeSwap();
    }
  }

  private startPartnerTurn() {
    if (this.partnerTurn) return;
    this.partnerTurn = true;
    this.partnerTurnStartedAt = performance.now();
    this.generationDone = false;
    this.awaitingAutoReply = false;
    this.cutByReconnect = false;
    this.pendingSpeak = null;
    this.maxRmsWhilePartner = 0;
    this.standingReply = null;
    if (this.learnerText.trim()) this.log(`  learner (live transcript, debug only): ${this.learnerText.trim()}`);
    this.learnerText = "";
    const since = this.turnClosedAt ? ` ${Math.round(performance.now() - this.turnClosedAt)} ms after the turn closed by ${this.closedBy.toUpperCase()}` : "";
    this.turnClosedAt = 0;
    this.log(`Partner starts${since}`);
    this.emit({ type: "partnerTurnStarted" });
  }

  private onPlaybackIdle() {
    this.partnerAudioEndedAt = performance.now();
    if (this.partnerTurn && this.generationDone) this.endPartnerTurn(false);
    this.maybeSwap();
  }

  private endPartnerTurn(interrupted: boolean) {
    if (!this.partnerTurn) return;
    this.partnerTurn = false;
    this.log(`  Partner: ${this.partnerText.trim()}`);
    this.log(`Partner turn ends${interrupted ? " (INTERRUPTED)" : ""} · mic max rms while Partner audio played ${this.maxRmsWhilePartner.toFixed(3)}`);
    this.partnerText = "";
    const cut = this.cutByReconnect && !interrupted;
    this.cutByReconnect = false;
    // The turn can end on the server's turnComplete, after the last sound: Response latency counts from that sound.
    const sinceAudioEndedMs = !interrupted && !this.playback.playing && this.partnerAudioEndedAt > this.partnerTurnStartedAt ? Math.round(performance.now() - this.partnerAudioEndedAt) : 0;
    this.emit({ type: "partnerTurnEnded", interrupted, ...(cut ? { cut } : {}), ...(sinceAudioEndedMs > 0 ? { sinceAudioEndedMs } : {}) });
  }

  // ---------- diagnostics ----------

  private usageSummary() {
    return `connections ${this.connections} · ${this.usage.summary()}`;
  }

  /** Every 30 s: is the audio path still healthy late in the call? */
  private logHealth() {
    const now = performance.now();
    const h = { at: now, audioTime: this.ctx.currentTime, frames: this.frames };
    if (this.health) {
      const wallS = (now - this.health.at) / 1000;
      const audioS = h.audioTime - this.health.audioTime;
      const fps = (h.frames - this.health.frames) / wallS;
      this.log(`health: ctx ${this.ctx.state} · mic ${fps.toFixed(1)} frames/s (want 25) · audio clock drift ${(((audioS - wallS) / wallS) * 1e6).toFixed(0)} ppm · playback underruns ${this.playback.underruns} · ${this.usageSummary()}`);
    }
    this.health = h;
    if (this.ctx.state !== "running" && !this.closed) {
      this.log(`AudioContext is ${this.ctx.state} → resume()`);
      void this.ctx.resume();
    }
  }
}
