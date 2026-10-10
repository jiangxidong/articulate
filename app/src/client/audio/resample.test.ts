import { describe, expect, it } from "vitest";
import { StreamResampler } from "./resample";

const sine = (hz: number, rate: number, n: number, from = 0) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * (i + from)) / rate));
const chunked = (r: StreamResampler, x: Float32Array, size: number) => {
  const parts: number[] = [];
  for (let i = 0; i < x.length; i += size) parts.push(...r.push(x.subarray(i, i + size)));
  return Float32Array.from(parts);
};

describe("StreamResampler", () => {
  it("gives the same output whatever the chunk sizes: the joins are seamless", () => {
    const x = sine(440, 24000, 24000);
    const whole = new StreamResampler(24000, 48000).push(x);
    for (const size of [960, 1920, 1013]) {
      const parts = chunked(new StreamResampler(24000, 48000), x, size);
      expect(parts.length).toBe(whole.length);
      expect(Math.max(...parts.map((v, i) => Math.abs(v - whole[i])))).toBeLessThan(1e-6);
    }
  });

  it("reproduces a tone at the new rate, 24 → 48 kHz and 24 → 44.1 kHz", () => {
    for (const outRate of [48000, 44100]) {
      const y = new StreamResampler(24000, outRate).push(sine(1000, 24000, 4800));
      const expected = sine(1000, outRate, y.length);
      // Away from the start, where the stream begins from silence.
      const err = Math.max(...y.slice(200).map((v, i) => Math.abs(v - expected[i + 200])));
      expect(err).toBeLessThan(0.01);
    }
  });

  it("passes audio through unchanged at the same rate", () => {
    const x = sine(440, 24000, 100);
    expect(new StreamResampler(24000, 24000).push(x)).toBe(x);
  });
});
