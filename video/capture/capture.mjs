// Screenshots the app's real screens for the demo video: bundles harness.ts with the app's ui.ts, serves it next to
// app/public (styles, Scene images), and saves each state at 3x with the boxes of the elements the film points at.
//   npm run capture        → ../articulate-demo/assets/screens/{<state>.png, wave-*.png, rects.json}
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = join(here, "dist");
const out = join(here, "../articulate-demo/assets/screens");
const VIEW = { width: 1280, height: 800 };
const SCALE = 3;
const WAVE_FRAMES = 8;

rmSync(dist, { recursive: true, force: true });
cpSync(join(here, "../../app/public"), dist, { recursive: true });
await build({ entryPoints: [join(here, "harness.ts")], outfile: join(dist, "harness.js"), bundle: true, format: "esm", logLevel: "warning" });
writeFileSync(join(dist, "index.html"), readFileSync(join(dist, "index.html"), "utf8").replace('src="app.js"', 'src="harness.js"'));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".png": "image/png", ".wav": "audio/wav" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = readFileSync(join(dist, path === "/" ? "index.html" : path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? TYPES[".html"] }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

// The elements each shot cuts to or clicks, by state. "all:" keeps every match, in order; "text:<selector>|<words>" is
// the box of those words inside the element.
const CALL_PARTS = {
  left: ".side:not(.right)", right: ".side.right", sideScene: ".side:not(.right) .scene", tracker: ".tracker", now: ".tracker li.now",
  thread: ".thread", items: "all:.thread > *", tag: "all:.type-tag", dock: ".dock", status: ".status", row: ".dock-row", done: "#done", end: "#end", hint: "#hint",
  clock: ".side:not(.right) > div:nth-child(2)", quote: "?text:.bubble.coach q|Um, I think, it depends.", fix: "?text:.bubble.coach > div:nth-child(3)|Open with your call: yes or no.",
};
const PARTS = {
  ready: {
    topbar: ".topbar", scene: ".ready .scene", setting: ".ready > p", focus: ".focus-card", pattern: ".ready > .pattern-fold",
    category: ".ready > .stack:not(.panel)", cta: ".call-cta", call: "#call",
  },
  summary: {
    topbar: ".topbar", head: ".sum-head", focus: ".focus-card", rounds: "all:.round-card", compares: "all:.compare",
    yours: "all:.compare .yours", better: "all:.compare .better", back: "#back",
    um: "text:.compare .yours|Um,", like: "text:.compare .yours|like,",
  },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", locale: "en-GB" });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.STATES);
mkdirSync(out, { recursive: true });

/** Freezes every CSS animation at a point in its cycle (0–1), so a shot is the same every run. */
const freeze = (phase) =>
  page.evaluate((phase) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = phase * a.effect.getComputedTiming().duration;
    }
  }, phase);

const rects = {};
for (const state of await page.evaluate(() => window.STATES)) {
  await page.evaluate((s) => window.shoot(s), state);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await freeze(0.25);
  rects[state] = await page.evaluate((parts) => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    };
    const words = (sel, text) => {
      const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
      for (let node; (node = walker.nextNode()); ) {
        const at = node.data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        return box(range);
      }
      throw new Error(`no "${text}" in ${sel}`);
    };
    // "?": only where the element exists (the Coaching point is in one state only).
    const find = (sel) =>
      sel.startsWith("?") ? (document.querySelector(sel.slice(6).split("|")[0]) ? find(sel.slice(1)) : null)
      : sel.startsWith("all:") ? [...document.querySelectorAll(sel.slice(4))].map(box)
      : sel.startsWith("text:") ? words(...sel.slice(5).split("|"))
      : box(document.querySelector(sel));
    const found = Object.entries(parts).map(([name, sel]) => [name, find(sel)]);
    return { page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }, ...Object.fromEntries(found) };
  }, PARTS[state] ?? CALL_PARTS);
  await page.screenshot({ path: join(out, `${state}.png`), fullPage: true });

  // The waveform's own animation, frame by frame, for the two states where it moves.
  const wave = { "call-hostile": "partner", "call-listening": "listening" }[state];
  if (wave) {
    const s = rects[state].status;
    for (let i = 0; i < WAVE_FRAMES; i++) {
      await freeze(i / WAVE_FRAMES);
      await page.screenshot({ path: join(out, `wave-${wave}-${i}.png`), clip: { x: s.x, y: s.y, width: s.w, height: s.h } });
    }
  }
  console.log(state);
}
// rects.js is the same data as a script, so the composition reads it without a fetch.
const data = JSON.stringify({ view: VIEW, scale: SCALE, waveFrames: WAVE_FRAMES, states: rects }, null, 1);
writeFileSync(join(out, "rects.json"), data);
writeFileSync(join(out, "rects.js"), `window.RECTS = ${data};\n`);

await browser.close();
server.close();
