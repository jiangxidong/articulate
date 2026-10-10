// The film's soundtrack, synthesized from scratch: a 120 BPM bed plus the UI sounds, mixed to one stereo WAV.
// Times are the same seconds the composition's timeline uses (index.html), so a change there is a change here.
//   node scripts/synth-audio.mjs   → assets/audio/track.wav
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SR = 44100, DUR = 20, N = SR * DUR, BEAT = 0.5;
const L = new Float32Array(N), R = new Float32Array(N);

// Seeded noise, so every run writes the same file.
let seed = 20261009;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;

/** Adds a mono voice at time t: fn(local seconds) → sample, for len seconds, at a pan of −1…1. */
function voice(t, len, gain, pan, fn) {
  const start = Math.round(t * SR), n = Math.round(len * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < n && start + i < N; i++) {
    if (start + i < 0) continue;
    const s = fn(i / SR, i);
    L[start + i] += s * gl;
    R[start + i] += s * gr;
  }
}
const TAU = Math.PI * 2;
const hz = (semitonesFromA2) => 110 * 2 ** (semitonesFromA2 / 12);
const lowpass = (cut) => {
  let y = 0;
  const a = 1 - Math.exp((-TAU * cut) / SR);
  return (x, c) => (y += (c === undefined ? a : 1 - Math.exp((-TAU * c) / SR)) * (x - y));
};

const kick = (t, g = 0.9) => voice(t, 0.32, g, 0, (x) => Math.sin(TAU * (48 * x + (70 / 28) * (1 - Math.exp(-28 * x)))) * Math.exp(-9 * x));
const hat = (t, g = 0.12, pan = 0.3) => {
  let prev = 0;
  voice(t, 0.06, g, pan, (x) => {
    const n = rand(), hp = n - prev;
    prev = n;
    return hp * Math.exp(-70 * x);
  });
};
const clap = (t, g = 0.3) => {
  const lp = lowpass(3200);
  voice(t, 0.18, g, -0.1, (x) => lp(rand()) * (Math.exp(-28 * x) + 0.6 * Math.exp(-90 * Math.abs(x - 0.012))) * 1.6);
};
const bass = (t, len, note, g = 0.34) => {
  const lp = lowpass(500), f = hz(note - 12);
  voice(t, len, g, 0, (x) => {
    const p = (x * f) % 1;
    return lp(p < 0.5 ? 1 : -1, 200 + 900 * Math.exp(-14 * x)) * Math.min(1, x * 400) * Math.exp(-3.5 * x);
  });
};
const pluck = (t, note, g = 0.13, pan = 0, len = 0.3) => {
  const f = hz(note);
  voice(t, len, g, pan, (x) => (Math.sin(TAU * f * x) + 0.35 * Math.sin(TAU * 2 * f * x) + 0.15 * Math.sin(TAU * 3 * f * x)) * Math.exp(-11 * x) * Math.min(1, x * 600));
};
const pad = (t, len, notes, g = 0.05) =>
  notes.forEach((note, k) => {
    const f = hz(note);
    voice(t, len, g, k % 2 ? 0.5 : -0.5, (x) => (Math.sin(TAU * f * x) + Math.sin(TAU * f * 1.004 * x)) * Math.min(1, x * 6) * Math.min(1, (len - x) * 3));
  });

// UI sounds.
const click = (t) => voice(t, 0.05, 0.5, 0.15, (x) => (Math.sin(TAU * 2300 * x) * Math.exp(-160 * x) + rand() * 0.5 * Math.exp(-400 * x)));
const pop = (t, note = 12, g = 0.2, pan = 0) => voice(t, 0.12, g, pan, (x) => Math.sin(TAU * hz(note) * (x + 2.5 * x * x)) * Math.exp(-34 * x));
const impact = (t, g = 0.9) => {
  const lp = lowpass(900);
  voice(t, 0.7, g, 0, (x) => Math.sin(TAU * (38 * x + (90 / 16) * (1 - Math.exp(-16 * x)))) * Math.exp(-5 * x) + lp(rand()) * 0.5 * Math.exp(-30 * x));
};
/** Filtered noise that swells into t. */
const whoosh = (t, len = 0.45, g = 0.28) => {
  const lp = lowpass(800);
  voice(t - len, len + 0.12, g, 0, (x) => {
    const k = Math.min(1, x / len);
    return lp(rand(), 300 + 6500 * k * k) * (x < len ? k * k : Math.exp(-40 * (x - len)));
  });
};

// ---- the hook (0–3 s): one hit per word, then the strike and a swell into the drop
[0.5, 1.0, 1.5].forEach((t, i) => {
  impact(t, 0.7);
  pluck(t, [0, 3, 7][i] + 12, 0.16, 0, 0.5);
});
voice(2.0, 0.4, 0.22, 0, (x) => rand() * Math.exp(-9 * x) * Math.min(1, x * 80)); // the strike
whoosh(3.0, 0.9, 0.34);

// ---- the groove (3–17 s): Am · F · C · G, one chord a bar
const CHORDS = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const ARP = [0, 2, 1, 2, 0, 2, 1, 3];
for (let b = 6; b < 34; b++) {
  const t = b * BEAT, bar = Math.floor(b / 4), chord = CHORDS[bar % 4];
  kick(t);
  if (b % 2) clap(t);
  hat(t + BEAT / 2, 0.13);
  hat(t + BEAT / 4, 0.05, -0.3);
  hat(t + (3 * BEAT) / 4, 0.05, -0.3);
  bass(t, 0.24, chord[0]);
  bass(t + BEAT / 2, 0.22, chord[0] + (b % 4 === 3 ? 7 : 0), 0.26);
  if (b % 4 === 0) pad(t, 2, chord.map((n) => n + 12));
  for (let s = 0; s < 4; s++) {
    const step = ARP[(b * 4 + s) % ARP.length];
    const note = step === 3 ? chord[0] + 24 : chord[step] + 12;
    if ((b * 4 + s) % 8 !== 5) pluck(t + (s * BEAT) / 4, note + 12, 0.07, s % 2 ? 0.55 : -0.55, 0.22);
  }
}

// ---- the lockup (17–20 s): the groove stops on a chord that rings out
impact(17, 1);
pad(17, 3, [0, 7, 12, 16, 19], 0.07);
[17.25, 17.5].forEach((t, i) => pop(t, 12 + i * 7, 0.2)); // the bubble, the face
pluck(18.0, 24, 0.14, -0.2, 0.9); // the eyebrow
pluck(18.5, 28, 0.14, 0.2, 1.2);

// ---- UI sounds on the beat
[3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5].forEach((t, i) => pop(t, 5 + i * 2, 0.16, -0.4 + i * 0.13)); // the Ready screen assembling
[6.1, 7.5, 7.75, 8.25, 10.0, 10.75, 11.75, 14.0, 14.75, 15.0, 15.5].forEach((t, i) => pop(t, i % 2 ? 17 : 12, 0.17, i % 2 ? 0.3 : -0.3)); // bubbles, rings, cards
[5.5, 9.25].forEach(click); // Call, Done
[6.0, 10.0, 14.0, 17.0].forEach((t) => whoosh(t));

// Master: a soft limiter, short fades at both ends.
const fade = (i) => Math.min(1, i / (0.01 * SR), (N - i) / (0.6 * SR));
const pcm = Buffer.alloc(44 + N * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + N * 4, 4); pcm.write("WAVEfmt ", 8); pcm.writeUInt32LE(16, 16);
pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28);
pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.round(Math.tanh(L[i] * 1.1) * fade(i) * 30000), 44 + i * 4);
  pcm.writeInt16LE(Math.round(Math.tanh(R[i] * 1.1) * fade(i) * 30000), 46 + i * 4);
}
const out = fileURLToPath(new URL("../assets/audio/track.wav", import.meta.url));
writeFileSync(out, pcm);
console.log(`wrote ${out}`);
