// Browser-side turn detection (ADR-0002). A learner turn opens when the mic level stays above the speech level
// (the higher barge-in level while the Partner is audible) for a few frames, and closes after a stretch of quiet
// or on Done.
import { PRE_ROLL_MS, type TurnEndedBy } from "../../engine/types";
import type { MicFrame } from "../audio/capture";

export interface TurnSettings {
  speechRms: number;
  bargeInRms: number;
  silenceMs: number;
  /** Consecutive 40 ms frames above the level that open a turn. */
  openFrames: number;
  /** Frames sent ahead of activityStart, so the first syllable isn't lost. */
  prerollFrames: number;
}

/** Tuned on iPhone speaker in ticket 01. */
export const DEFAULT_TURN_SETTINGS: TurnSettings = {
  speechRms: 0.02,
  bargeInRms: 0.08,
  silenceMs: 4500,
  openFrames: 3,
  prerollFrames: PRE_ROLL_MS / 40,
};

export interface TurnHandlers {
  open(preroll: ArrayBuffer[], rms: number, bargeIn: boolean): void;
  audio(pcm: ArrayBuffer): void;
  close(by: TurnEndedBy, speechMs: number): void;
}

export class TurnDetector {
  private ring: ArrayBuffer[] = [];
  private loudRun = 0;
  private openedAt = 0;
  private lastLoudAt = 0;
  isOpen = false;

  constructor(private settings: TurnSettings, private handlers: TurnHandlers) {}

  frame({ pcm, rms }: MicFrame, partnerAudible: boolean, now: number) {
    if (!this.isOpen) {
      this.ring.push(pcm);
      if (this.ring.length > this.settings.prerollFrames) this.ring.shift();
      this.loudRun = rms > (partnerAudible ? this.settings.bargeInRms : this.settings.speechRms) ? this.loudRun + 1 : 0;
      if (this.loudRun < this.settings.openFrames) return;
      this.isOpen = true;
      this.loudRun = 0;
      this.openedAt = this.lastLoudAt = now;
      const preroll = this.ring;
      this.ring = [];
      this.handlers.open(preroll, rms, partnerAudible);
      return;
    }
    this.handlers.audio(pcm);
    if (rms > this.settings.speechRms) this.lastLoudAt = now;
    else if (now - this.lastLoudAt > this.settings.silenceMs) this.close("silence", now);
  }

  /** Done. */
  close(by: TurnEndedBy, now: number) {
    if (!this.isOpen) return;
    this.isOpen = false;
    const speechEnd = by === "silence" ? this.lastLoudAt : now;
    this.handlers.close(by, speechEnd - this.openedAt);
  }

  /** Drops a turn without telling anyone (the call ended). */
  reset() {
    this.isOpen = false;
    this.loudRun = 0;
    this.ring = [];
  }
}
