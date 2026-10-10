import { describe, expect, it } from "vitest";
import { assessMic } from "./mic-check";

// Mic levels are RMS per 40 ms frame, as the turn detector sees them.
const frames = (rms: number, n = 50) => Array.from({ length: n }, () => rms);
/** Speech: loud frames with quiet gaps between words. */
const speaking = (rms: number) => [...frames(rms, 40), ...frames(rms * 0.1, 10), ...frames(rms * 1.2, 30)];

describe("assessMic", () => {
  it("keeps the default levels when the room is quiet and the Partner's echo is low", () => {
    expect(assessMic({ quiet: frames(0.003), speech: speaking(0.1), echo: frames(0.02) })).toMatchObject({
      verdict: "clear", speechRms: 0.02, bargeInRms: 0.08,
    });
  });

  it("keeps the defaults for a quietly spoken phrase with long pauses (iPhone, 2026-10-07)", () => {
    // Measured: noise 0.002, echo 0.019, and most of the phrase's frames between pauses under 0.02.
    const phrase = [...frames(0.003, 60), ...frames(0.012, 40), ...frames(0.03, 30), ...frames(0.06, 20)];
    expect(assessMic({ quiet: frames(0.002), speech: phrase, echo: frames(0.019) })).toMatchObject({
      verdict: "clear", speechRms: 0.02, bargeInRms: 0.08,
    });
  });

  it("raises the speech level when quiet-room noise isn't well below it", () => {
    const r = assessMic({ quiet: frames(0.015), speech: speaking(0.15), echo: frames(0.02) });
    expect(r).toMatchObject({ verdict: "adjusted", speechRms: 0.03, bargeInRms: 0.08 });
  });

  it("raises the barge-in level above the Partner's echo", () => {
    const r = assessMic({ quiet: frames(0.003), speech: speaking(0.2), echo: [...frames(0.01), 0.07, 0.075, 0.07, ...frames(0.01)] });
    expect(r.verdict).toBe("adjusted");
    expect(r.bargeInRms).toBeCloseTo(0.105);
  });

  it("ignores a single loud echo frame: a turn only opens after 3 loud frames in a row", () => {
    const r = assessMic({ quiet: frames(0.003), speech: speaking(0.1), echo: [...frames(0.01), 0.2, ...frames(0.01)] });
    expect(r).toMatchObject({ verdict: "clear", bargeInRms: 0.08 });
  });

  it("recommends headphones when the Partner's echo is too loud to set a barge-in level above it", () => {
    const r = assessMic({ quiet: frames(0.003), speech: speaking(0.2), echo: frames(0.12) });
    expect(r.verdict).toBe("headphones");
    expect(r.bargeInRms).toBe(0.15);
  });

  it("says the room is too noisy when the speech level would have to go too high, and keeps the default speech level", () => {
    expect(assessMic({ quiet: frames(0.04), speech: speaking(0.2), echo: frames(0.01) })).toMatchObject({ verdict: "noisy", speechRms: 0.02 });
  });

  it("keeps the default speech level when the quiet phase caught the learner talking (iPhone, 2026-10-08)", () => {
    // Measured: "noise" 0.158, echo 0.035. Saved as speech 0.06, it lost quiet openings in the next call.
    expect(assessMic({ quiet: frames(0.158), speech: speaking(0.2), echo: frames(0.035) })).toMatchObject({
      verdict: "noisy", speechRms: 0.02, bargeInRms: 0.08,
    });
  });

  it("asks to try again when it heard no speech above the speech level", () => {
    expect(assessMic({ quiet: frames(0.003), speech: frames(0.01), echo: frames(0.01) })).toMatchObject({
      verdict: "noSpeech", speechRms: 0.02, bargeInRms: 0.08,
    });
  });
});
