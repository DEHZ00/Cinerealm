/**
 * CineRealm - Node.js Server
 * Handles: static files, maintenance mode, notification endpoint, SPA routing
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware: parse JSON bodies ──────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Maintenance Mode ────────────────────────────────────────────────────────
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";
const MAINTENANCE_PASSWORD = process.env.MAINTENANCE_PASSWORD || "cinerealm2026";

// Paths that always bypass maintenance
const BYPASS_PATHS = [
  "/maintenance-auth",
  "/style.css",
  "/script.js",
  "/sw.js",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/favicon-16x16.png",
  "/apple-touch-icon.png",
  "/offline.html",
  "/notification.json",
];

function makeToken(password) {
  // Simple deterministic token from password — no in-memory state needed
  return crypto.createHmac("sha256", password + "cr_salt_2026").update("maintenance_access").digest("hex");
}

function isValidSession(cookieHeader, password) {
  const match = (cookieHeader || "").match(/cr_maintenance_session=([a-f0-9]{64})/);
  if (!match) return false;
  return match[1] === makeToken(password);
}

app.use((req, res, next) => {
  if (!MAINTENANCE_MODE) return next();

  // Always allow bypass paths
  if (BYPASS_PATHS.some(p => req.path.startsWith(p))) return next();

  // Check session cookie (works across serverless restarts)
  if (isValidSession(req.headers.cookie, MAINTENANCE_PASSWORD)) return next();

  // Not authenticated — for API/fetch requests return JSON error, for pages return maintenance HTML
  const wantsHtml = req.headers.accept && req.headers.accept.includes("text/html");
  if (!wantsHtml) {
    return res.status(503).json({ error: "Site is under maintenance" });
  }

  res.status(503).sendFile(path.join(__dirname, "public", "maintenance.html"));
});

// ── Maintenance Auth Endpoint ──────────────────────────────────────────────
app.post("/maintenance-auth", (req, res) => {
  const { password } = req.body;
  if (password === MAINTENANCE_PASSWORD) {
    const token = makeToken(MAINTENANCE_PASSWORD);
    res.setHeader(
      "Set-Cookie",
      `cr_maintenance_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`
    );
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

// ── Static Files ───────────────────────────────────────────────────────────
// CSS, JS, HTML — no-cache so deploys propagate instantly
app.use((req, res, next) => {
  const ext = path.extname(req.path).toLowerCase();
  if ([".css", ".js", ".html"].includes(ext) || req.path === "/") {
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
  } else if ([".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".woff", ".woff2"].includes(ext)) {
    res.setHeader("Cache-Control", "public, max-age=604800"); // 7 days for images/fonts
  }
  next();
});

app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
}));

// ── SPA / Pretty URL Routing ───────────────────────────────────────────────
// Maps clean URLs → HTML files in /public
const routes = {
  "/":          "index.html",
  "/movies":    "movies/movies.html",
  "/trending":  "trending/trending.html",
  "/watchlist": "watchlist.html",
  "/search":    "search.html",
  "/legal":     "legal.html",
  "/games":     "games.html",
  "/genres":    "genres.html",
  "/games-proxy": "games-proxy.html",
};

// Dynamic watch routes: /watch/movie/:id  /watch/tv/:id/season/:s/episode/:e
app.get("/watch/:type/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "watch", "watch.html"), err => {
    if (err) res.status(404).send("Not Found");
  });
});
app.get("/watch/:type/:id/season/:season/episode/:episode", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "watch", "watch.html"), err => {
    if (err) res.status(404).send("Not Found");
  });
});

// Named routes
Object.entries(routes).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    const filePath = path.join(__dirname, "public", file);
    res.sendFile(filePath, err => {
      if (err) res.status(404).send("Not Found");
    });
  });
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
  if (MAINTENANCE_MODE) {
    console.log(`🔧 MAINTENANCE MODE is ON  (password: ${MAINTENANCE_PASSWORD})`);
  }
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || "development"}\n`);
});

module.exports = app;
