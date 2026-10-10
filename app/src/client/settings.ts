// The learner's settings on this device: the Holding phrases picked at onboarding and the turn-detection levels from
// the mic check. Small, so they live in localStorage. If it's unavailable (some private modes), they're kept in
// memory for this visit, so onboarding can't loop back on itself, and onboarding shows again next visit.
import { HOLDING_PHRASES, HOLDING_PHRASE_COUNT, type HoldingPhrase } from "../content/practice";
import { DEFAULT_TURN_SETTINGS } from "./live/turn-detector";
import type { MicVerdict } from "./mic-check";

export interface Settings {
  /** HoldingPhrase ids, exactly HOLDING_PHRASE_COUNT once onboarding is done. */
  holdingPhrases: string[];
  /** From the last mic check; the default levels when there was none. */
  turn?: { speechRms: number; bargeInRms: number; verdict: MicVerdict; checkedAt: number };
}

const KEY = "bl.settings";
let unsaved: Settings | null = null;

// The mic check only ever raises the spike's levels. A level below them was saved by its first version, which could
// lower them by mistake (ticket 07: speech 0.008 on iPhone), and is dropped for the defaults. So is a speech level
// raised by a "noisy" verdict, which earlier versions saved (iPhone, 2026-10-08: 0.06 from a quiet phase with talking).
const isLevel = (x: unknown, floor: number) => typeof x === "number" && x >= floor && x < 1;
const raisedByNoise = (t: NonNullable<Settings["turn"]>) => t.verdict === "noisy" && t.speechRms > DEFAULT_TURN_SETTINGS.speechRms;

export function loadSettings(): Settings {
  if (unsaved) return unsaved;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Settings>;
    const turn = s.turn && isLevel(s.turn.speechRms, DEFAULT_TURN_SETTINGS.speechRms) && isLevel(s.turn.bargeInRms, DEFAULT_TURN_SETTINGS.bargeInRms) &&
      !raisedByNoise(s.turn) ? s.turn : undefined;
    return { holdingPhrases: Array.isArray(s.holdingPhrases) ? s.holdingPhrases : [], ...(turn ? { turn } : {}) };
  } catch {
    return { holdingPhrases: [] };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    unsaved = null;
  } catch {
    unsaved = s;
  }
}

/** The learner's phrases, in the content's order; empty until exactly HOLDING_PHRASE_COUNT known ones are picked. */
export function pickedPhrases(s: Settings): HoldingPhrase[] {
  const picked = HOLDING_PHRASES.filter((p) => s.holdingPhrases.includes(p.id));
  return picked.length === HOLDING_PHRASE_COUNT ? picked : [];
}
