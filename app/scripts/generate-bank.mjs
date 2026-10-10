// Ticket 06: tools for the Question bank and the Scene library, which are generated once and committed
// (src/content/question-bank.json, public/scenes/*.jpg), so a Session costs nothing extra. The questions were written
// by subagents in a Claude Code session, and the Scene images were generated in Antigravity from the prompts this
// script writes, so none of this calls an API.
//
//   node scripts/generate-bank.mjs merge <file.json...>   adds questions: [{ sceneId, questions: [{ text, difficulty }] }]
//   node scripts/generate-bank.mjs validate               checks the bank against the rules below
//   node scripts/generate-bank.mjs prompts                writes the image prompts to content/scenes/image-prompts.md
//   node scripts/generate-bank.mjs images                 normalises public/scenes/<sceneId>.(png|jpg|jpeg|webp) to JPEG
//   node scripts/generate-bank.mjs drop <questionId...>   removes questions
import { execSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const BANK = join(APP, "src/content/question-bank.json");
const IMAGES = join(APP, "public/scenes");
const PROMPTS = join(APP, "..", "content/scenes/image-prompts.md");

const CATEGORIES = ["Everyday decisions", "Tech & society", "Personal opinions", "Products & AI"];
const DIFFICULTIES = ["easy", "medium", "hard"];
/** A Session takes three questions from one Scene: two Rounds and the Transfer question. */
const MIN_PER_SCENE = 3;
const MAX_WORDS = 30;
const LEAD_INS = /^(different topic|next question|quick one|last one|okay|ok|so)\b/i;

// Every Scene image shares this style, from content/scenes/01-corner-cafe.md.
const IMAGE_STYLE =
  "Warm editorial illustration. Calm, slightly muted palette of honey, slate blue and walnut, soft natural light. " +
  "No readable text, no logos, no faces in close-up. Full-bleed wide 16:9 composition, no border or frame.";
const STYLE_REFERENCE = "01-corner-cafe";
const MATCH_STYLE =
  "Match the illustration style of the attached reference image exactly (line work, texture, palette, lighting), but draw a different scene.";

const load = () => JSON.parse(readFileSync(BANK, "utf8"));
const save = (bank) => writeFileSync(BANK, JSON.stringify(bank, null, 2) + "\n");
const wordCount = (t) => t.split(/\s+/).filter(Boolean).length;

function merge(files) {
  const bank = load();
  for (const file of files) {
    for (const { sceneId, questions } of JSON.parse(readFileSync(file, "utf8"))) {
      const scene = bank.scenes.find((s) => s.id === sceneId);
      if (!scene) throw new Error(`${file}: no Scene ${sceneId}`);
      let n = Math.max(0, ...bank.questions.filter((q) => q.sceneId === sceneId).map((q) => Number(q.id.split("/")[1])));
      for (const q of questions) {
        n++;
        bank.questions.push({ id: `${sceneId}/${n}`, sceneId, category: scene.category, difficulty: q.difficulty, text: q.text.trim() });
      }
    }
  }
  save(bank);
  validate();
}

function validate() {
  const bank = load();
  const problems = [];
  for (const s of bank.scenes) {
    for (const k of ["id", "title", "when", "setting", "category", "imagePrompt"]) if (!s[k]) problems.push(`${s.id}: no ${k}`);
    if (!CATEGORIES.includes(s.category)) problems.push(`${s.id}: category ${s.category}`);
    const n = bank.questions.filter((q) => q.sceneId === s.id).length;
    if (n < MIN_PER_SCENE) problems.push(`${s.id}: ${n} questions`);
  }
  const ids = new Set();
  const texts = new Map();
  for (const q of bank.questions) {
    if (ids.has(q.id)) problems.push(`${q.id}: duplicate id`);
    ids.add(q.id);
    const scene = bank.scenes.find((s) => s.id === q.sceneId);
    if (!scene) problems.push(`${q.id}: no Scene`);
    else if (q.category !== scene.category) problems.push(`${q.id}: category differs from its Scene`);
    if (!DIFFICULTIES.includes(q.difficulty)) problems.push(`${q.id}: difficulty ${q.difficulty}`);
    if (wordCount(q.text) > MAX_WORDS) problems.push(`${q.id}: ${wordCount(q.text)} words`);
    if (LEAD_INS.test(q.text)) problems.push(`${q.id}: starts with a lead-in`);
    if (!/\?$/.test(q.text)) problems.push(`${q.id}: doesn't end with a question`);
    const key = q.text.toLowerCase().replace(/[^a-z ]/g, "");
    if (texts.has(key)) problems.push(`${q.id}: same text as ${texts.get(key)}`);
    texts.set(key, q.id);
  }
  const count = (c) => `${c}: ${bank.scenes.filter((s) => s.category === c).length} Scenes, ${bank.questions.filter((q) => q.category === c).length} questions`;
  console.log(CATEGORIES.map(count).join("\n"));
  console.log(`total: ${bank.scenes.length} Scenes, ${bank.questions.length} questions, ${bank.scenes.filter((s) => s.image).length} images`);
  if (problems.length) {
    console.log(problems.join("\n"));
    process.exitCode = 1;
  }
}

function prompts() {
  const bank = load();
  const todo = bank.scenes.filter((s) => !s.image);
  const lines = [
    "# Scene image prompts",
    "",
    "Written by `app/scripts/generate-bank.mjs prompts`, for the Scenes that have no image yet.",
    "",
    "1. In Antigravity (Nano Banana), attach `app/public/scenes/" + STYLE_REFERENCE + ".jpg` as the style reference with every prompt.",
    "2. Save each image as `app/public/scenes/<Scene id>.png` (or .jpg; any wide aspect ratio).",
    "3. In `app/`, run `node scripts/generate-bank.mjs images`. It turns each into a 1024 px JPEG and links it to its Scene.",
    "",
    "Every prompt ends with the same style instruction:",
    "",
    `> ${MATCH_STYLE} ${IMAGE_STYLE}`,
    "",
    `## Scenes without an image (${todo.length})`,
    "",
  ];
  for (const s of todo) {
    lines.push(`### ${s.id} — ${s.title} (${s.category})`, "", "```text", `${s.imagePrompt} ${MATCH_STYLE} ${IMAGE_STYLE}`, "```", "");
  }
  writeFileSync(PROMPTS, lines.join("\n"));
  console.log(`${todo.length} prompts → ${PROMPTS}`);
}

function images() {
  const bank = load();
  for (const s of bank.scenes) {
    const src = ["png", "jpeg", "webp", "jpg"].map((ext) => join(IMAGES, `${s.id}.${ext}`)).find(existsSync);
    if (!src) continue;
    const out = join(IMAGES, `${s.id}.jpg`);
    const width = Number(execSync(`sips -g pixelWidth "${src}"`, { encoding: "utf8" }).match(/pixelWidth: (\d+)/)[1]);
    if (src === out && width <= 1024 && s.image) continue;
    // macOS sips: at most 1024 px wide, JPEG quality 65, so each image stays around 100–200 KB.
    const tmp = join(IMAGES, `${s.id}.tmp.jpg`);
    execSync(`sips -s format jpeg -s formatOptions 65 -Z 1024 "${src}" --out "${tmp}"`, { stdio: "ignore" });
    if (src !== out) rmSync(src);
    renameSync(tmp, out);
    s.image = `scenes/${s.id}.jpg`;
    console.log(`${s.id}: ${out}`);
  }
  save(bank);
}

function drop(ids) {
  const bank = load();
  bank.questions = bank.questions.filter((q) => !ids.includes(q.id));
  save(bank);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "merge") merge(args);
else if (cmd === "validate") validate();
else if (cmd === "prompts") prompts();
else if (cmd === "images") images();
else if (cmd === "drop") drop(args);
else console.log("usage: generate-bank.mjs merge <files> | validate | prompts | images | drop <ids>");
