// Token usage and estimated cost of one Live call, from the server's usageMetadata messages.

// $ per 1M tokens for gemini-3.8-live. Thinking tokens bill as output text.
const RATES = {
  in: { AUDIO: 3.0, TEXT: 0.75, IMAGE: 1.0, VIDEO: 1.0 } as Record<string, number>,
  out: { AUDIO: 12.0, TEXT: 4.5 } as Record<string, number>,
};

export interface UsageMetadata {
  promptTokenCount?: number;
  thoughtsTokenCount?: number;
  promptTokensDetails?: { modality: string; tokenCount?: number }[];
  responseTokensDetails?: { modality: string; tokenCount?: number }[];
}

export class LiveUsage {
  private inByModality: Record<string, number> = {};
  private outByModality: Record<string, number> = {};
  private thoughts = 0;
  /** Grows every turn: the whole context is re-billed per turn. */
  private lastPrompt = 0;

  add(u: UsageMetadata) {
    for (const d of u.promptTokensDetails ?? []) this.inByModality[d.modality] = (this.inByModality[d.modality] ?? 0) + (d.tokenCount ?? 0);
    for (const d of u.responseTokensDetails ?? []) this.outByModality[d.modality] = (this.outByModality[d.modality] ?? 0) + (d.tokenCount ?? 0);
    this.thoughts += u.thoughtsTokenCount ?? 0;
    this.lastPrompt = u.promptTokenCount ?? 0;
  }

  /** Unknown modalities are priced like audio, the most expensive known rate. */
  private cost() {
    let c = (this.thoughts / 1e6) * RATES.out.TEXT;
    for (const [m, n] of Object.entries(this.inByModality)) c += (n / 1e6) * (RATES.in[m] ?? RATES.in.AUDIO);
    for (const [m, n] of Object.entries(this.outByModality)) c += (n / 1e6) * (RATES.out[m] ?? RATES.out.AUDIO);
    return c;
  }

  summary() {
    return `in ${JSON.stringify(this.inByModality)} · out ${JSON.stringify(this.outByModality)} · thoughts ${this.thoughts} · last prompt ${this.lastPrompt} · est $${this.cost().toFixed(3)}`;
  }
}
