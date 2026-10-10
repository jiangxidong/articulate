// The Question bank and the Scene library (ticket 06): generated once and committed, so a Session costs nothing extra.
// See scripts/generate-bank.mjs.
import bank from "./question-bank.json";
import type { BankQuestion, Category, Difficulty, Scene } from "./scene";

export const SCENES: Scene[] = bank.scenes.map(({ id, title, when, setting, category, image }) => ({ id, title, when, setting, category: category as Category, image }));
export const QUESTIONS: BankQuestion[] = bank.questions.map((q) => ({ ...q, category: q.category as Category, difficulty: q.difficulty as Difficulty }));

export const sceneTitle = (id: string) => SCENES.find((s) => s.id === id)?.title ?? id;
