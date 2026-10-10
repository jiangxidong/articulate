// Resamples the Partner's audio stream to the AudioContext's rate, chunk after chunk, as one continuous signal.
// Handing each 24 kHz chunk to the browser as its own AudioBuffer makes it resample every chunk on its own, and the
// joins click (an offline render in Chrome: steps of up to 0.08 full scale at chunk boundaries, every 40–80 ms). The
// learner heard that as crackle and buzz under the Partner's voice (iPhone, 2026-10-09).

/** Taps on each side of the windowed-sinc kernel: 16 input samples, 0.67 ms of delay at 24 kHz. */
const HALF_TAPS = 16;

/** Blackman-windowed sinc, x in input samples, zero outside ±HALF_TAPS. */
function kernel(x: number, cutoff: number) {
  if (Math.abs(x) >= HALF_TAPS) return 0;
  const w = 0.42 + 0.5 * Math.cos((Math.PI * x) / HALF_TAPS) + 0.08 * Math.cos((2 * Math.PI * x) / HALF_TAPS);
  const s = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
  return (x === 0 ? cutoff : s) * w;
}

/** The kernel is tabulated at this many fractional positions between input samples. */
const PHASES = 256;

export class StreamResampler {
  /** Input samples not yet used up (the kernel needs HALF_TAPS on each side of an output sample). */
  private history!: Float32Array;
  /** Position of the next output sample, in input samples from the start of `history`. */
  private pos!: number;
  private readonly step: number;
  /** table[phase * 2 * HALF_TAPS + k]: the weight of input sample i0 + k − HALF_TAPS + 1 at that phase. */
  private readonly table = new Float32Array((PHASES + 1) * 2 * HALF_TAPS);

  constructor(readonly inRate: number, readonly outRate: number) {
    this.step = inRate / outRate;
    // Downsampling (a 16 kHz context) needs the filter below the output's Nyquist.
    const cutoff = Math.min(1, outRate / inRate);
    for (let p = 0; p <= PHASES; p++)
      for (let k = 0; k < 2 * HALF_TAPS; k++) this.table[p * 2 * HALF_TAPS + k] = kernel(k - HALF_TAPS + 1 - p / PHASES, cutoff);
    this.reset();
  }

  /**
   * The output for this chunk. The last HALF_TAPS input samples are held back until the next chunk, so the joins are
   * seamless; reset() drops them when the stream breaks (the Partner stopped or was cut off).
   */
  push(input: Float32Array): Float32Array {
    if (this.inRate === this.outRate) return input;
    const x = new Float32Array(this.history.length + input.length);
    x.set(this.history);
    x.set(input, this.history.length);
    const out: number[] = [];
    // Enough input on both sides of the kernel.
    while (this.pos + HALF_TAPS < x.length) {
      const i0 = Math.floor(this.pos);
      const row = Math.round((this.pos - i0) * PHASES) * 2 * HALF_TAPS;
      let acc = 0;
      for (let k = 0; k < 2 * HALF_TAPS; k++) acc += x[i0 - HALF_TAPS + 1 + k] * this.table[row + k];
      out.push(acc);
      this.pos += this.step;
    }
    const keepFrom = Math.max(0, Math.floor(this.pos) - HALF_TAPS);
    this.history = x.slice(keepFrom);
    this.pos -= keepFrom;
    return Float32Array.from(out);
  }

  /** A fresh stream: silence before its first sample. */
  reset() {
    this.history = new Float32Array(HALF_TAPS);
    this.pos = HALF_TAPS;
  }
}
