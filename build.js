/**
 * CineRealm Build Script
 * Vercel runs this automatically via the "build" script in package.json.
 *
 * What it does:
 *   1. Minifies public/script.js  → public/script.min.js
 *   2. Minifies public/style.css  → public/style.min.css
 *   3. (Optional) Obfuscates the generated script.min.js
 *
 * To edit the site: edit public/script.js and public/style.css normally.
 * The .min.* files are BUILD OUTPUT — every page loads those, so never hand-edit
 * them or they'll drift out of sync with the source.
 *
 * Obfuscation is opt-in: set OBFUSCATE=true. It's off by default because it adds
 * ~30-60% back to the file size and costs runtime performance, which cancels out
 * most of the benefit of minifying in the first place.
 *
 * NOTE: the previous version of this script obfuscated public/script.js IN PLACE.
 * That was doubly wrong — it destroyed the source file, and every page loads
 * script.min.js, so the obfuscated output never actually reached a user.
 */

const fs   = require("fs");
const path = require("path");

const OBFUSCATE = process.env.OBFUSCATE === "true";
const SCRIPT_MIN = path.join(__dirname, "public", "script.min.js");

(async () => {
  // ── 1 + 2. Minify ────────────────────────────────────────────────────────
  await require("./minify.js");

  // ── 3. Optional obfuscation of the BUILD OUTPUT (never the source) ───────
  if (!OBFUSCATE) {
    console.log("ℹ  Obfuscation skipped (set OBFUSCATE=true to enable)");
    return;
  }

  let JavaScriptObfuscator;
  try {
    JavaScriptObfuscator = require("javascript-obfuscator");
  } catch (e) {
    console.log("⚠  javascript-obfuscator not installed — skipping obfuscation");
    return;
  }

  console.log("🔒 Obfuscating public/script.min.js...");
  const source = fs.readFileSync(SCRIPT_MIN, "utf8");

  const result = JavaScriptObfuscator.obfuscate(source, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: "hexadecimal",
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,          // keep global fn names (showToast etc still work)
    selfDefending: false,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 5,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ["base64"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: "function",
    stringArrayThreshold: 0.75,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  });

  fs.writeFileSync(SCRIPT_MIN, result.getObfuscatedCode());
  console.log("✅ Obfuscation complete");
  console.log(`   Minified:   ${(source.length / 1024).toFixed(1)}kb`);
  console.log(`   Obfuscated: ${(result.getObfuscatedCode().length / 1024).toFixed(1)}kb`);
})().catch(err => {
  console.error("❌ Build failed:", err.message);
  process.exit(1);
});
