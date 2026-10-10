import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSettings } from "./settings";

const saved = (turn: object) => {
  const store = new Map([["bl.settings", JSON.stringify({ holdingPhrases: ["bottom-line"], turn })]]);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} });
};

describe("loadSettings", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("drops a speech level that an earlier mic check raised on a \"noisy\" verdict", () => {
    saved({ speechRms: 0.06, bargeInRms: 0.08, verdict: "noisy", checkedAt: 1 });
    expect(loadSettings()).toEqual({ holdingPhrases: ["bottom-line"] });
  });

  it("keeps levels the mic check raised for this device", () => {
    const turn = { speechRms: 0.03, bargeInRms: 0.1, verdict: "adjusted", checkedAt: 1 };
    saved(turn);
    expect(loadSettings().turn).toEqual(turn);
  });

  it("drops levels below the spike's defaults (ticket 07)", () => {
    saved({ speechRms: 0.008, bargeInRms: 0.08, verdict: "headphones", checkedAt: 1 });
    expect(loadSettings()).not.toHaveProperty("turn");
  });
});
