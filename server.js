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

// ── Maintenance Mode Middleware ────────────────────────────────────────────
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === "true";
const MAINTENANCE_PASSWORD = process.env.MAINTENANCE_PASSWORD || "cinerealm2026";

// Session store (in-memory; survives until server restart)
const maintenanceSessions = new Set();

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Paths that bypass maintenance even without a session
const BYPASS_PATHS = ["/maintenance", "/maintenance-auth", "/style.css", "/favicon.ico"];

app.use((req, res, next) => {
  if (!MAINTENANCE_MODE) return next();

  // Always allow static assets and auth endpoint
  if (BYPASS_PATHS.some(p => req.path.startsWith(p))) return next();

  // Check session cookie
  const rawCookie = req.headers.cookie || "";
  const match = rawCookie.match(/cr_maintenance_session=([a-f0-9]{64})/);
  if (match && maintenanceSessions.has(match[1])) return next();

  // Not authenticated → serve maintenance page
  res.status(503).sendFile(path.join(__dirname, "public", "maintenance.html"));
});

// ── Maintenance Auth Endpoint ──────────────────────────────────────────────
app.post("/maintenance-auth", (req, res) => {
  const { password } = req.body;
  if (password === MAINTENANCE_PASSWORD) {
    const token = generateSessionToken();
    maintenanceSessions.add(token);
    // Cookie lasts 8 hours
    res.setHeader(
      "Set-Cookie",
      `cr_maintenance_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`
    );
    res.json({ success: true });
  } else {
    // Small delay to discourage brute force
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
app.use(express.static(path.join(__dirname, "public"), {
  maxAge: "1d",
  etag: true,
}));

// ── SPA / Pretty URL Routing ───────────────────────────────────────────────
// Maps clean URLs → HTML files in /public
const routes = {
  "/":          "index.html",
  "/movies":    "movies.html",
  "/trending":  "trending.html",
  "/watchlist": "watchlist.html",
  "/search":    "search.html",
  "/legal":     "legal.html",
  "/games":     "games.html",
};

// Dynamic watch routes: /watch/movie/:id  /watch/tv/:id/season/:s/episode/:e
app.get("/watch/:type/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "watch.html"), err => {
    if (err) res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
  });
});
app.get("/watch/:type/:id/season/:season/episode/:episode", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "watch.html"), err => {
    if (err) res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
  });
});

// Named routes
Object.entries(routes).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    const filePath = path.join(__dirname, "public", file);
    res.sendFile(filePath, err => {
      if (err) res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
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
