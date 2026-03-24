/**
 * CineRealm - Node.js Server
 * Section 22 — Performance & Security optimizations
 */

const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const crypto   = require("crypto");
const https    = require("https");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── In-memory server-side cache (TTL: 10 min) ─────────────────────────────
const _serverCache = new Map();
const SERVER_CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  const entry = _serverCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > SERVER_CACHE_TTL) { _serverCache.delete(key); return null; }
  return entry.data;
}
function setCached(key, data) {
  // Cap cache size at 500 entries — evict oldest
  if (_serverCache.size >= 500) {
    const firstKey = _serverCache.keys().next().value;
    _serverCache.delete(firstKey);
  }
  _serverCache.set(key, { data, ts: Date.now() });
}

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false }));

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// ── Rate limiting (manual, no extra deps) ────────────────────────────────
const _rateLimits = new Map(); // ip → { count, reset }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX    = 120;        // requests per window

function rateLimit(req, res, next) {
  // Skip rate limiting on Vercel (serverless — no persistent state)
  if (process.env.VERCEL) return next();

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = _rateLimits.get(ip);

  if (!entry || now > entry.reset) {
    _rateLimits.set(ip, { count: 1, reset: now + RATE_LIMIT_WINDOW });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ error: "Too many requests, slow down" });
  }

  next();
}

// ── Maintenance Mode ────────────────────────────────────────────────────────
const MAINTENANCE_MODE     = process.env.MAINTENANCE_MODE === "true";
const MAINTENANCE_PASSWORD = process.env.MAINTENANCE_PASSWORD || "cinerealm2026";
const BYPASS_PATHS = [
  "/maintenance-auth", "/style.css", "/script.js", "/sw.js",
  "/manifest.json", "/cloak-config.js",
  "/favicon.ico", "/favicon-32x32.png", "/favicon-16x16.png",
  "/apple-touch-icon.png", "/offline.html", "/notification.json",
  "/android-chrome-512x512.png", "/android-chrome-192x192.png",
];

function makeToken(password) {
  return crypto.createHmac("sha256", password + "cr_salt_2026").update("maintenance_access").digest("hex");
}
function isValidSession(cookieHeader, password) {
  const match = (cookieHeader || "").match(/cr_maintenance_session=([a-f0-9]{64})/);
  if (!match) return false;
  return match[1] === makeToken(password);
}

app.use((req, res, next) => {
  if (!MAINTENANCE_MODE) return next();
  if (BYPASS_PATHS.some(p => req.path.startsWith(p))) return next();
  if (isValidSession(req.headers.cookie, MAINTENANCE_PASSWORD)) return next();
  const wantsHtml = req.headers.accept?.includes("text/html");
  if (!wantsHtml) return res.status(503).json({ error: "Site is under maintenance" });
  res.status(503).sendFile(path.join(__dirname, "public", "maintenance.html"));
});

app.post("/maintenance-auth", (req, res) => {
  const { password } = req.body;
  if (password === MAINTENANCE_PASSWORD) {
    const token = makeToken(MAINTENANCE_PASSWORD);
    res.setHeader("Set-Cookie", `cr_maintenance_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    res.json({ success: true });
  } else {
    setTimeout(() => res.status(401).json({ success: false, error: "Incorrect password" }), 800);
  }
});

// ── Notification JSON ──────────────────────────────────────────────────────
app.get("/notification.json", (req, res) => {
  const notifPath = path.join(__dirname, "notification.json");
  if (fs.existsSync(notifPath)) {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(notifPath);
  } else {
    res.json({ active: false });
  }
});

// ── Manifest ──────────────────────────────────────────────────────────────
app.get("/manifest.json", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Content-Type", "application/manifest+json");
  res.sendFile(path.join(__dirname, "public", "manifest.json"), err => {
    if (err) res.json({
      name: "CineRealm", short_name: "CineRealm", start_url: "/",
      display: "standalone", background_color: "#080808", theme_color: "#ff2c2c",
      icons: [{ src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }]
    });
  });
});

// ── Static Files ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if ([".css", ".js", ".html"].includes(ext)) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else if ([".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".woff", ".woff2"].includes(ext)) {
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    }
  }
}));

// Helper
function sendHTML(res, filePath) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(filePath, err => { if (err) res.status(404).send("Not Found"); });
}

// ── Cloak config ──────────────────────────────────────────────────────────
app.get("/cloak-config.js", (req, res) => {
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "cloak-config.js"), err => {
    if (err) res.status(404).send("// not found");
  });
});

// ── AniList GraphQL Proxy (with server-side cache) ────────────────────────
app.post("/api/anilist", rateLimit, async (req, res) => {
  try {
    const body    = JSON.stringify(req.body);
    const cacheKey = "anilist:" + crypto.createHash("md5").update(body).digest("hex");

    // Return cached response if available
    const cached = getCached(cacheKey);
    if (cached) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("X-Cache", "HIT");
      return res.status(200).send(cached);
    }

    const options = {
      hostname: "graphql.anilist.co",
      path: "/", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 8000,
    };

    const proxyReq = https.request(options, proxyRes => {
      let data = "";
      proxyRes.on("data", chunk => data += chunk);
      proxyRes.on("end", () => {
        // Cache successful responses
        if (proxyRes.statusCode === 200) setCached(cacheKey, data);
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("X-Cache", "MISS");
        res.status(proxyRes.statusCode).send(data);
      });
    });

    proxyReq.on("error", err => {
      console.error("AniList proxy error:", err.message);
      res.status(502).json({ error: "AniList proxy failed" });
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      res.status(504).json({ error: "AniList request timed out" });
    });

    proxyReq.write(body);
    proxyReq.end();
  } catch(err) {
    console.error("AniList proxy error:", err);
    res.status(500).json({ error: "Internal proxy error" });
  }
});

app.options("/api/anilist", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(200);
});

// ── Cache stats endpoint (dev only) ──────────────────────────────────────
app.get("/api/cache-stats", (req, res) => {
  if (process.env.NODE_ENV === "production" && !process.env.DEV_STATS) {
    return res.status(403).json({ error: "Forbidden" });
  }
  res.json({
    size: _serverCache.size,
    entries: [..._serverCache.keys()].map(k => ({
      key: k.slice(0, 60),
      age: Math.round((Date.now() - _serverCache.get(k).ts) / 1000) + "s"
    }))
  });
});

// ── SPA / Pretty URL Routing ───────────────────────────────────────────────
const routes = {
  "/":          "index.html",
  "/movies":    "movies/movies.html",
  "/trending":  "trending/trending.html",
  "/watchlist": "watchlist.html",
  "/search":    "search.html",
  "/legal":     "legal.html",
  "/games":     "games.html",
  "/genres":    "genres.html",
  "/anime":     "anime.html",
  "/stats":     "stats.html",
  "/games-proxy": "games-proxy.html",
};

app.get("/watch/:type/:id", (req, res) => sendHTML(res, path.join(__dirname, "public", "watch", "watch.html")));
app.get("/watch/:type/:id/season/:season/episode/:episode", (req, res) => sendHTML(res, path.join(__dirname, "public", "watch", "watch.html")));

Object.entries(routes).forEach(([route, file]) => {
  app.get(route, (req, res) => sendHTML(res, path.join(__dirname, "public", file)));
});

// ── 404 Fallback ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "404.html"), err => {
    if (err) res.status(404).send("404 - Not Found");
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬 CineRealm running on http://localhost:${PORT}`);
  if (MAINTENANCE_MODE) console.log(`🔧 MAINTENANCE MODE is ON`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}\n`);
});

module.exports = app;
