// Holding phrases and Thinking patterns (spec → Content). The learner picks 3 of the 6 phrases at onboarding.

// Both follow the learner's course on high-stakes PM communication (Paraphrase → ADD: Answer, Detail, Describe, then a
// clean stop; a first read with a tripwire for questions they haven't prepared).

export type ThinkingPatternId = "answerFirst" | "firstRead" | "twoOptions";

export interface ThinkingPattern {
  id: ThinkingPatternId;
  name: string;
  /** The steps of an answer, shown as "Answer → Detail → So what → Stop". */
  skeleton: string[];
  /**
   * The Partner's one sentence introducing it, word for word, in the first few Sessions. Short: the skeleton and the
   * example are on the screen.
   */
  intro: string;
  /** A filled-in skeleton on a neutral topic (never the Session's own questions), shown while it's introduced. */
  example: { question: string; answer: string };
}

/** In the order they are introduced, one per Session. */
export const THINKING_PATTERNS: ThinkingPattern[] = [
  {
    id: "answerFirst",
    name: "Answer first",
    skeleton: ["Answer", "Detail", "So what", "Stop"],
    intro: "Today's pattern is Answer first. It's on your screen.",
    example: {
      question: "Should we move the launch to May?",
      answer: "Yes, move it. QA needs two more weeks. That buys a stable launch instead of a rushed one.",
    },
  },
  {
    id: "firstRead",
    name: "First read",
    skeleton: ["First read", "It turns on X", "If X flips", "My call"],
    intro: "Today's pattern is First read. It's on your screen.",
    example: {
      question: "Will the vendor deliver on time?",
      answer: "My first read is yes. It turns on their API sign-off on Friday. If that slips, we switch to the backup. So I'd keep the date and check Friday.",
    },
  },
  {
    id: "twoOptions",
    name: "Two options + pick",
    skeleton: ["A or B", "My pick", "Because", "So for you"],
    intro: "Today's pattern is Two options and pick. It's on your screen.",
    example: {
      question: "Contractor, or wait for headcount?",
      answer: "Contractor or wait. I'd hire the contractor, because waiting costs us the Q3 launch. For you, that's the launch on time for about 20k.",
    },
  },
];

export const patternById = (id: ThinkingPatternId) => THINKING_PATTERNS.find((p) => p.id === id);

export interface HoldingPhrase {
  id: string;
  text: string;
  /** The Thinking pattern this phrase opens, if any: the Hint offers it first on that pattern's days. */
  fits?: ThinkingPatternId;
  /** The words that show the learner used it, in a transcript (the summary counts Holding phrase uses). */
  cue: string;
}

export const HOLDING_PHRASES: HoldingPhrase[] = [
  { id: "short-answer-why", text: "Short answer: yes — here's why.", fits: "answerFirst", cue: "short answer" },
  { id: "bottom-line", text: "My bottom line is …", fits: "answerFirst", cue: "my bottom line" },
  // A paraphrase: buys a second and can reframe a hostile question. It opens any pattern.
  { id: "question-is-whether", text: "So the question is whether …", cue: "the question is whether" },
  { id: "first-read", text: "My first read is …", fits: "firstRead", cue: "my first read" },
  { id: "not-fully-assessed", text: "Not fully assessed yet — my first read is …", fits: "firstRead", cue: "not fully assessed" },
  { id: "two-options", text: "There are two options here, and I'd pick …", fits: "twoOptions", cue: "there are two options" },
];

/** The learner picks exactly this many. */
export const HOLDING_PHRASE_COUNT = 3;
