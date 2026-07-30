/**
 * CineRealm Minify Script
 *
 * Generates public/script.min.js and public/style.min.css from the sources.
 * Run `npm run minify` after editing public/script.js or public/style.css so
 * the .min files never drift out of sync with the originals.
 */

const fs   = require("fs");
const path = require("path");

// Resolved lazily: on a production install (NODE_ENV=production) npm skips
// devDependencies, so these may be absent. The .min files are committed, so a
// missing minifier must degrade to "use what's committed" — never fail a deploy.
let minify, CleanCSS;
try {
  ({ minify } = require("terser"));
  CleanCSS = require("clean-css");
} catch (e) {
  minify = null;
}

const PUB = path.join(__dirname, "public");

async function minifyJS() {
  const src = path.join(PUB, "script.js");
  const out = path.join(PUB, "script.min.js");
  const code = fs.readFileSync(src, "utf8");

  const result = await minify(code, {
    ecma: 2020,
    compress: { passes: 2, drop_debugger: true },
    mangle: { toplevel: false },   // keep globals — inline HTML calls showToast() etc.
    format: { comments: false },
  });

  if (result.error) throw result.error;
  fs.writeFileSync(out, result.code);
  return { from: code.length, to: result.code.length };
}

function minifyCSS() {
  const src = path.join(PUB, "style.css");
  const out = path.join(PUB, "style.min.css");
  const code = fs.readFileSync(src, "utf8");

  // level 1 only (whitespace/comment stripping, no rule restructuring).
  // level 2 merges ~370 of this sheet's 1276 rules and reorders selectors —
  // risky in a stylesheet built from iterative overrides, and worth just
  // ~0.8kb once brotli is applied. Not a trade worth making.
  const result = new CleanCSS({ level: 1, rebase: false }).minify(code);
  if (result.errors.length) throw new Error(result.errors.join("\n"));
  fs.writeFileSync(out, result.styles);
  return { from: code.length, to: result.styles.length };
}

async function run() {
  if (!minify) {
    console.log("⚠  terser/clean-css not installed — keeping the committed .min files");
    console.log("   (run `npm install` then `npm run minify` locally to regenerate)");
    return;
  }
  const kb = n => (n / 1024).toFixed(1) + "kb";
  const js  = await minifyJS();
  console.log(`✅ script.min.js   ${kb(js.from)} → ${kb(js.to)}`);
  const css = minifyCSS();
  console.log(`✅ style.min.css   ${kb(css.from)} → ${kb(css.to)}`);
}

// Export the promise so build.js can `await require("./minify.js")` and be sure
// both files are fully written before it touches them.
module.exports = run();

module.exports.catch(err => {
  console.error("❌ Minify failed:", err.message);
  process.exit(1);
});
