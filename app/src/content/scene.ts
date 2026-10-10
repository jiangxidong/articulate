export const CATEGORIES = ["Everyday decisions", "Tech & society", "Personal opinions", "Products & AI"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Difficulty = "easy" | "medium" | "hard";

/** A concrete everyday moment, shown as an image and a one-line setting. Its questions are asked in it. */
export interface Scene {
  id: string;
  title: string;
  /** Short time-of-day label for the Scene card, e.g. "Sat · 10:40". */
  when: string;
  setting: string;
  category: Category;
  /** Path under the site root, or null until the image is generated. */
  image: string | null;
}

/** A Question bank entry: asked as a Main question in Round 1 or 2, or as the Transfer question. */
export interface BankQuestion {
  id: string;
  sceneId: string;
  category: Category;
  difficulty: Difficulty;
  text: string;
}

/** The Scene library and its questions. */
export interface QuestionBank {
  scenes: Scene[];
  questions: BankQuestion[];
}

/** What a Session asks: three questions from one Scene. */
export interface SessionQuestions {
  scene: Scene;
  rounds: [BankQuestion, BankQuestion];
  transfer: BankQuestion;
}
