// Bundles the page and the audio worklet into dist/, next to the static files and the test-only fake-mic clips.
// Scripts and the stylesheet are referenced with a content hash (?v=), so a phone never keeps running an old build.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const version = (path) => createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 10);

rmSync("dist", { recursive: true, force: true });
cpSync("public", "dist", { recursive: true });
cpSync("test/fake-mic", "dist/test/fake-mic", { recursive: true, filter: (p) => !/\.(sh|py)$/.test(p) });
const common = { bundle: true, format: "esm", target: ["safari16", "chrome110"], sourcemap: true, logLevel: "warning" };
await build({ ...common, entryPoints: ["src/worklet/audio-worklet.ts"], outfile: "dist/audio-worklet.js" });
await build({
  ...common,
  entryPoints: ["src/client/main.ts"],
  outfile: "dist/app.js",
  define: { __AUDIO_WORKLET_URL__: JSON.stringify(`audio-worklet.js?v=${version("dist/audio-worklet.js")}`) },
});
const html = readFileSync("dist/index.html", "utf8")
  .replace('src="app.js"', `src="app.js?v=${version("dist/app.js")}"`)
  .replace('href="styles.css"', `href="styles.css?v=${version("dist/styles.css")}"`);
writeFileSync("dist/index.html", html);
console.log("built dist/");
