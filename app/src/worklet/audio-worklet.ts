// The call's audio thread, at the AudioContext's native rate (48 kHz on iPhone):
// - "capture": whatever feeds it (the mic, or the test fake mic) → 16 kHz mono Int16 frames of 40 ms (640 samples)
//   plus each frame's RMS level;
// - "player": plays the Partner's audio from a queue, sample after sample, so chunk joins never click
//   (src/client/audio/playback.ts).

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const OUT_RATE = 16000;
const FRAME = 640;
const RENDER_QUANTUM = 128;

class Capture extends AudioWorkletProcessor {
  private ratio = sampleRate / OUT_RATE;
  private pos = 0; // fractional read position in the current block
  private out = new Int16Array(FRAME);
  private n = 0;
  private sumSq = 0;
  private lp = 0;
  private silence = new Float32Array(RENDER_QUANTUM);

  process(inputs: Float32Array[][]) {
    // With nothing connected (or a source between clips) there is no channel; treat that as silence so that
    // frames keep flowing and the silence timer keeps running.
    const input = inputs[0]?.[0] ?? this.silence;
    const block = new Float32Array(input.length);
    // Crude one-pole low-pass before decimating.
    for (let i = 0; i < input.length; i++) block[i] = this.lp += 0.45 * (input[i] - this.lp);
    while (this.pos < block.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const a = block[i], b = i + 1 < block.length ? block[i + 1] : a;
      const s = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.sumSq += s * s;
      this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === FRAME) {
        const rms = Math.sqrt(this.sumSq / FRAME);
        this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
        this.out = new Int16Array(FRAME);
        this.n = 0;
        this.sumSq = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= block.length;
    return true;
  }
}

registerProcessor("capture", Capture);

/** Audio buffered before a stream starts playing (as a jitter buffer), and the longest wait for it. */
const PREBUFFER_S = 0.06;
const MAX_PREBUFFER_WAIT_S = 0.1;

export type PlayerMessage = { type: "chunk"; samples: Float32Array; seq: number } | { type: "clear" };
/** The queue ran dry after the chunk numbered seq. */
export type PlayerEvent = { type: "idle"; seq: number };

class Player extends AudioWorkletProcessor {
  private queue: Float32Array[] = [];
  private offset = 0;
  private queued = 0;
  /** Playing, as opposed to filling the jitter buffer. */
  private started = false;
  private waited = 0;
  private lastSeq = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<PlayerMessage>) => {
      const m = e.data;
      if (m.type === "clear") {
        this.queue = [];
        this.offset = this.queued = this.waited = 0;
        this.started = false;
        return;
      }
      this.queue.push(m.samples);
      this.queued += m.samples.length;
      this.lastSeq = m.seq;
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0];
    if (!out) return true;
    if (!this.started) {
      this.waited += this.queued > 0 ? out.length : 0;
      if (this.queued === 0 || (this.queued < PREBUFFER_S * sampleRate && this.waited < MAX_PREBUFFER_WAIT_S * sampleRate)) {
        out.fill(0);
        return true;
      }
      this.started = true;
      this.waited = 0;
    }
    let i = 0;
    while (i < out.length && this.queue.length) {
      const head = this.queue[0];
      const n = Math.min(out.length - i, head.length - this.offset);
      out.set(head.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      this.queued -= n;
      if (this.offset === head.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (i < out.length) {
      out.fill(0, i);
      this.started = false;
      this.port.postMessage({ type: "idle", seq: this.lastSeq } satisfies PlayerEvent);
    }
    return true;
  }
}

registerProcessor("player", Player);
