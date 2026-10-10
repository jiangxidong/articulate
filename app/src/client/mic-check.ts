// The onboarding mic check (user stories 4–5): checks the turn-detection levels (ADR-0002) against this device.
// It records mic levels in three phases (a quiet room, the learner speaking, the Partner's voice on the speaker). The
// levels tuned on iPhone in the spike are only ever raised: the speech level when the room's noise isn't well below
// it, the barge-in level when the Partner's echo isn't below it. Raised too far, the learner's speech wouldn't clear
// them, so the check says the room is too noisy or recommends headphones instead.
import { DEFAULT_TURN_SETTINGS } from "./live/turn-detector";

export type MicVerdict =
  /** The default levels fit this device. */
  | "clear"
  /** A level was raised to fit this device. */
  | "adjusted"
  /** The Partner's echo on speaker is too loud for any usable barge-in level. */
  | "headphones"
  /**
   * The room's noise is too loud for any usable speech level. The speech level stays at the default: a level this high
   * would lose quiet speech in every call, and the noise is often the learner talking during the quiet phase (iPhone,
   * 2026-10-08: "noise" 0.158).
   */
  | "noisy"
  /** Nothing was heard while the learner was meant to speak. */
  | "noSpeech";

export interface MicCheckResult {
  verdict: MicVerdict;
  speechRms: number;
  bargeInRms: number;
  /** What was measured, for the log: noise (95th percentile), the voice's median and 90th percentile, the echo. */
  noise: number;
  voice: { p50: number; p90: number };
  echo: number;
}

/** The speech level sits this far above the noise (95th percentile)... */
const NOISE_MARGIN = 2;
/** ...and the barge-in level this far above the echo. */
const ECHO_MARGIN = 1.5;
/**
 * Above these, ordinary speech may not open a turn or cut in (ticket 01: barge-in speech peaked at RMS 0.175), so
 * the check gives up on the level and says why instead.
 */
const MAX_SPEECH_RMS = 0.06;
const MAX_BARGE_IN_RMS = 0.15;
/** Half a second of 40 ms frames above the speech level: less than this, and the mic didn't hear the learner. */
const MIN_SPEECH_FRAMES = 12;
/** A turn opens after this many loud frames in a row. */
const OPEN_FRAMES = DEFAULT_TURN_SETTINGS.openFrames;

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function percentile(xs: number[], p: number) {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** The loudest level held for OPEN_FRAMES frames in a row: what would open a turn. */
function sustained(xs: number[]) {
  let best = 0;
  for (let i = 0; i + OPEN_FRAMES <= xs.length; i++) best = Math.max(best, Math.min(...xs.slice(i, i + OPEN_FRAMES)));
  return best;
}

/** Levels are mic RMS per 40 ms frame, as the turn detector sees them. */
export function assessMic(levels: { quiet: number[]; speech: number[]; echo: number[] }): MicCheckResult {
  const { speechRms: defaultSpeech, bargeInRms: defaultBargeIn } = DEFAULT_TURN_SETTINGS;
  const noise = percentile(levels.quiet, 0.95);
  const echo = sustained(levels.echo);
  const speechRms = Math.max(defaultSpeech, noise * NOISE_MARGIN);
  const bargeInRms = Math.max(defaultBargeIn, echo * ECHO_MARGIN);
  const spoken = levels.speech.filter((x) => x > speechRms);
  const result = {
    speechRms: round3(Math.min(speechRms, MAX_SPEECH_RMS)),
    bargeInRms: round3(Math.min(bargeInRms, MAX_BARGE_IN_RMS)),
    noise: round3(noise),
    voice: { p50: round3(percentile(spoken, 0.5)), p90: round3(percentile(spoken, 0.9)) },
    echo: round3(echo),
  };
  if (speechRms > MAX_SPEECH_RMS) return { verdict: "noisy", ...result, speechRms: defaultSpeech };
  if (spoken.length < MIN_SPEECH_FRAMES) return { verdict: "noSpeech", ...result, speechRms: defaultSpeech, bargeInRms: defaultBargeIn };
  if (bargeInRms > MAX_BARGE_IN_RMS) return { verdict: "headphones", ...result };
  const changed = result.speechRms !== defaultSpeech || result.bargeInRms !== defaultBargeIn;
  return { verdict: changed ? "adjusted" : "clear", ...result };
}
