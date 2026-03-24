/**
 * CineRealm Build Script
 * Obfuscates public/script.js before deploy
 * Vercel runs this automatically via the "build" script in package.json
 * 
 * To edit the site: edit public/script.js normally
 * On deploy: Vercel runs this, obfuscated version is what users see
 * Your original is always safe in git
 */

const fs   = require("fs");
const path = require("path");

let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require("javascript-obfuscator");
} catch(e) {
  console.log("⚠  javascript-obfuscator not installed — skipping obfuscation");
  process.exit(0);
}

const srcPath = path.join(__dirname, "public", "script.js");

if (!fs.existsSync(srcPath)) {
  console.error("❌ public/script.js not found");
  process.exit(1);
}

console.log("🔒 Obfuscating public/script.js...");
const source = fs.readFileSync(srcPath, "utf8");

const result = JavaScriptObfuscator.obfuscate(source, {
  // ── Balanced obfuscation (Option 2) ─────────────────────────────────────
  compact: true,
  controlFlowFlattening: false,       // off — keeps performance good
  deadCodeInjection: false,           // off — keeps file size down
  debugProtection: false,             // off — don't want to break devtools entirely
  disableConsoleOutput: true,         // hides console.log output from users
  identifierNamesGenerator: "hexadecimal", // var names become _0x1a2b3c
  log: false,
  numbersToExpressions: true,         // 10 → (2*5) — harder to read
  renameGlobals: false,               // keep global fn names (showToast etc still work)
  selfDefending: false,               // off — can cause issues on some browsers
  simplify: true,
  splitStrings: true,                 // "hello world" → "hel"+"lo "+"world"
  splitStringsChunkLength: 5,
  stringArray: true,                  // all strings go into an encoded array
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64"],    // base64 encode the string array
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.75,        // 75% of strings get encoded
  transformObjectKeys: false,         // off — can break object access
  unicodeEscapeSequence: false,       // off — makes file too large
});

fs.writeFileSync(srcPath, result.getObfuscatedCode());
console.log("✅ Obfuscation complete");
console.log(`   Original: ${(source.length / 1024).toFixed(1)}kb`);
console.log(`   Obfuscated: ${(result.getObfuscatedCode().length / 1024).toFixed(1)}kb`);
