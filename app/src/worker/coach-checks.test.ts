import { describe, expect, it } from "vitest";
import { betterVersionProblems, givesAWording } from "./coach-checks";

// What the learner said in the Round (questions included), as the Better version is checked against it.
const ROUND = `Main question: Should cafés stop taking cash completely? Yes or no — and why?
Learner: Ah, no, I don't think so, like, most people pay by card now, but, um, some people still need cash.
Learner: Counting the cash takes maybe 20 minutes every night. So honestly, it's a small cost.
Partner: Put a number on it — what percentage would change your mind? Over twenty-five percent?
Learner: Maybe if almost nobody paid cash, like under 5%, then handling cash costs more than it brings in.`;

const fixes = (text: string) => betterVersionProblems(text, ROUND).map((p) => p.fix);

describe("betterVersionProblems", () => {
  it("accepts a short Answer → Detail → So what built on the learner's own numbers", () => {
    expect(betterVersionProblems(
      "No, keep cash. Counting it takes about 20 minutes a night. So regulars who only carry cash keep coming back.",
      ROUND,
    )).toEqual([]);
  });

  it("flags a sentence much longer than about 12 words", () => {
    const [p, ...rest] = betterVersionProblems(
      "No, keep cash. Counting the cash every single night takes only about twenty minutes of one person's time, which is a really small cost for the business.",
      ROUND,
    );
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ hard: false });
    expect(p.fix).toMatch(/24 words/);
  });

  it("flags a number the learner never gave, as a hard problem", () => {
    const problems = betterVersionProblems("No, keep cash. About 30% of customers still pay with it. So the regulars stay.", ROUND);
    expect(problems).toEqual([{ hard: true, fix: expect.stringMatching(/30/) }]);
  });

  it("matches numbers written as words or digits, and takes numbers from the questions too", () => {
    expect(fixes("No, keep cash. It costs twenty minutes a night. Below five percent, I'd drop it. Above 25%, it stays.")).toEqual([]);
  });

  it("flags an opening that praises the question or paraphrases it instead of giving the Answer", () => {
    expect(fixes("That's a great question. No, keep cash. So the regulars stay.")).toEqual([expect.stringMatching(/first sentence/)]);
    expect(fixes("So the question is whether cash is worth it. No, keep it.")).toEqual([expect.stringMatching(/first sentence/)]);
  });

  it("reads curly apostrophes, number words with hundred or thousand, a bare 1, and a.m. like the learner's words", () => {
    const round = "Learner: About five thousand dollars, or two hundred a day, at 9 a.m. on one Saturday.";
    expect(betterVersionProblems("Yes. It costs 5,000 dollars, or 200 a day. That starts at 9 a.m. on 1 Saturday.", round)).toEqual([]);
    expect(betterVersionProblems("It costs five thousand dollars. So keep it.", "Learner: It's 5,000 dollars.")).toEqual([]);
    expect(fixes("That’s a great question. No, keep cash.")).toEqual([expect.stringMatching(/first sentence/)]);
  });

  it("flags more than five sentences", () => {
    expect(fixes("No. Keep cash. It is cheap. Twenty minutes. Regulars use it. They stay. So keep it.")).toEqual([expect.stringMatching(/sentences/)]);
  });
});

describe("givesAWording", () => {
  it("catches a fix that hands the learner a sentence to say", () => {
    expect(givesAWording(`Start with: "I'd keep cash for the regulars."`)).toBe(true);
    expect(givesAWording("Start directly with: 'I think it's a bad idea because of the queue.'")).toBe(true);
    expect(givesAWording("Start directly with: ‘I think it’s a bad idea because of the queue.’")).toBe(true);
  });

  it("lets through a fix that only says what to change", () => {
    expect(givesAWording("Your Answer came in your third sentence. Put it first.")).toBe(false);
    expect(givesAWording("Don't restate the question; it's your call that comes first, then the learner's Detail.")).toBe(false);
  });
});
