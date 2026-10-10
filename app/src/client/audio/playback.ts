// Plays the Partner's 24 kHz PCM chunks on the call's AudioContext. They are resampled to the context's rate as one
// stream (resample.ts) and queued in the "player" worklet, which plays them sample after sample.
//
// Before, each chunk was its own AudioBufferSourceNode at 24 kHz. The browser resampled every chunk on its own and
// rounded each start to the nearest frame, and the joins clicked every 40–80 ms. An offline render in Chrome showed
// steps of up to 0.08 full scale. The learner heard crackle and buzz under the Partner's voice (iPhone, 2026-10-09).
import type { PlayerEvent, PlayerMessage } from "../../worklet/audio-worklet";
import { loadAudioWorklet } from "./capture";
import { StreamResampler } from "./resample";

/** Audio arriving this soon after the queue ran dry was a gap inside a turn: counted as an underrun. */
const UNDERRUN_WINDOW_MS = 500;

export class Playback {
  private node: AudioWorkletNode | null = null;
  /** Sent before the worklet was ready. */
  private pending: PlayerMessage[] = [];
  private resampler: StreamResampler | null = null;
  /** Number of the last chunk sent; an idle report about an earlier one is stale. */
  private seq = 0;
  private idleAt = 0;
  playing = false;
  /** Times the queue ran dry mid-turn. */
  underruns = 0;

  constructor(private ctx: AudioContext, private onIdle: () => void) {
    void loadAudioWorklet(ctx).then(() => {
      const node = new AudioWorkletNode(ctx, "player", { numberOfInputs: 0, outputChannelCount: [1] });
      node.port.onmessage = (e: MessageEvent<PlayerEvent>) => this.onEvent(e.data);
      node.connect(ctx.destination);
      this.node = node;
      this.pending.forEach((m) => this.send(m));
      this.pending = [];
    });
  }

  enqueue(base64: string, mimeType: string) {
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
    const bin = atob(base64);
    const n = bin.length >> 1;
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      pcm[i] = v / 32768;
    }
    if (!this.playing) {
      // A new stream, or a gap: it restarts after the worklet's jitter buffer.
      if (this.idleAt && performance.now() - this.idleAt < UNDERRUN_WINDOW_MS) this.underruns++;
      this.resampler = null;
    }
    if (this.resampler?.inRate !== rate) this.resampler = new StreamResampler(rate, this.ctx.sampleRate);
    const samples = this.resampler.push(pcm);
    if (!samples.length) return;
    this.playing = true;
    this.send({ type: "chunk", samples, seq: ++this.seq });
  }

  stop() {
    this.pending = [];
    this.send({ type: "clear" });
    this.resampler = null;
    this.playing = false;
  }

  private send(m: PlayerMessage) {
    if (!this.node) return void this.pending.push(m);
    if (m.type === "chunk") this.node.port.postMessage(m, [m.samples.buffer]);
    else this.node.port.postMessage(m);
  }

  private onEvent(e: PlayerEvent) {
    if (e.seq !== this.seq || !this.playing) return;
    this.playing = false;
    this.idleAt = performance.now();
    this.onIdle();
  }
}
