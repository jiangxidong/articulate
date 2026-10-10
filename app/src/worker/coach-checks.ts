// The Worker's checks on what the Coach brain writes, where a rule can be checked without a model. Pure, so they are
// tested on their own (coach-checks.test.ts).

/** Curly single quotes as straight ones: models write both. */
const straight = (text: string) => text.replace(/[‘’]/g, "'");

/** A long single-quoted phrase. An apostrophe inside a word ("it's") doesn't end it. */
export const hasSingleQuotedPhrase = (text: string) =>
  /(^|\s)'(?:[^']|(?<=[a-z])'(?=[a-z])){12,}'(?![a-z])/i.test(straight(text));

/** Text in double quotes, or a long single-quoted phrase: a wording handed to the learner. */
export const givesAWording = (text: string) => /["“”]/.test(text) || hasSingleQuotedPhrase(text);

/** The course (lesson 0004): a sentence of about 12 words at most. A few more are still one breath. */
const MAX_SENTENCE_WORDS = 16;
/** Answer, a Detail of one or two sentences, the so what; a First read adds its "if X flips". */
const MAX_SENTENCES = 5;

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const WORD_VALUES = new Map<string, number>([
  ...UNITS.map((w, i) => [w, i] as [string, number]),
  ...TENS.map((w, i) => [w, i * 10] as [string, number]).filter(([w]) => w),
  ["hundred", 100], ["thousand", 1000],
]);

/**
 * The numbers in a text, written as digits ("1,000", "9:00" → 9 and 0) or words ("twenty-five" → 25, "five thousand" →
 * 5000). 1 is left out: "one" is as often a pronoun ("the first one") as a number.
 */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) found.add(Number(m[0].replace(/,/g, "")));
  let reading: number | undefined;
  const done = () => {
    if (reading !== undefined) found.add(reading);
    reading = undefined;
  };
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    const v = WORD_VALUES.get(w);
    if (v === undefined) done();
    else if (v >= 100) reading = (reading ?? 1) * v;
    else if (reading !== undefined && reading % 100 >= 20 && reading % 10 === 0 && v < 10) reading += v;
    else {
      done();
      reading = v;
    }
  }
  done();
  found.delete(1);
  return found;
}

/** Sentences, not split after an abbreviation such as "a.m.". */
export const sentencesOf = (text: string) => text.split(/(?<!\b[a-z]\.[a-z]\.)(?<=[.!?])\s+/i).map((s) => s.trim()).filter(Boolean);
export const wordCount = (sentence: string) => sentence.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;

export interface Problem {
  /** Told to the Coach brain when it is asked again. */
  fix: string;
  /** A broken rule rather than a style miss: the text can't be shown even after the second attempt. */
  hard: boolean;
}

/**
 * Checks a Better version against the course's rules: the Answer first (no praise or paraphrase of the question), short
 * sentences, and no number the learner didn't give. `round` is everything said in the Round, questions included.
 */
export function betterVersionProblems(text: string, round: string): Problem[] {
  const problems: Problem[] = [];
  const sentences = sentencesOf(straight(text));
  if (/^(that'?s |that is |what )?(a |an )?(really )?(great|good|interesting|tough) question\b/i.test(sentences[0] ?? "") ||
    /^so,? the (question|real question|issue) is\b/i.test(sentences[0] ?? "")) {
    problems.push({ hard: false, fix: `Your first sentence "${sentences[0]}" isn't the Answer. Start with the learner's Answer.` });
  }
  if (sentences.length > MAX_SENTENCES) {
    problems.push({ hard: false, fix: `You wrote ${sentences.length} sentences. Use 3 or 4: Answer, Detail, so what.` });
  }
  for (const s of sentences) {
    const n = wordCount(s);
    if (n > MAX_SENTENCE_WORDS) problems.push({ hard: false, fix: `"${s}" has ${n} words. Split it: about 12 words per sentence at most.` });
  }
  const given = numbersIn(round);
  const invented = [...numbersIn(text)].filter((n) => !given.has(n));
  if (invented.length) {
    problems.push({ hard: true, fix: `You used ${invented.join(", ")}, which the learner never said. Use only numbers from the learner's Answers.` });
  }
  return problems;
}
