/**
 * CineRealm Asset Stamping
 *
 * Rewrites every page's local .js/.css references to carry a hash of the
 * file's current contents: /script.min.js → /script.min.js?v=1a2b3c4d5e.
 *
 * Cloudflare sits in front of the site and replaces the Cache-Control on JS
 * and CSS with max-age=14400, whatever server.js or vercel.json send. Browsers
 * then reuse a bundle for up to four hours without asking, so a deploy only
 * showed up after a hard refresh. Pages themselves still go out no-cache, so a
 * new hash in the page is enough to make the browser fetch the new file.
 *
 * minify.js runs this after writing the bundles, and build.js runs it again
 * after obfuscating, since that changes the bundle's contents.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUB  = path.join(ROOT, "public");

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith(".html") ? [p] : [];
  });
}

function stampAssets() {
  const hashes = new Map();
  // Served from public/ first, then the repo root (cloak-config.js has its own
  // route). Anything else, like /_vercel/insights, is left exactly as written.
  const hashOf = rel => {
    if (!hashes.has(rel)) {
      const file = [path.join(PUB, rel), path.join(ROOT, rel)]
        .find(f => fs.existsSync(f) && fs.statSync(f).isFile());
      hashes.set(rel, file
        ? crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 10)
        : null);
    }
    return hashes.get(rel);
  };

  let pages = 0;
  for (const file of htmlFiles(PUB)) {
    const html = fs.readFileSync(file, "utf8");
    const out = html.replace(
      /((?:src|href)=")(\/(?!\/)[^"?#]+\.(?:js|css))(?:\?v=[0-9a-f]+)?"/g,
      (all, attr, url) => {
        const h = hashOf(url.slice(1));
        return h ? `${attr}${url}?v=${h}"` : all;
      }
    );
    if (out !== html) { fs.writeFileSync(file, out); pages++; }
  }
  return pages;
}

module.exports = stampAssets;
