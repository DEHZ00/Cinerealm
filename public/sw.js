/**
 * CineRealm Service Worker
 * - Caches static assets (CSS, JS, fonts) on install
 * - Caches TMDB poster images as they're loaded (cache-first for images)
 * - Network-first for API calls (falls back to cache if offline)
 * - Shows offline fallback page if page navigation fails
 */

const SW_VERSION   = "cr-v1";
const STATIC_CACHE = `${SW_VERSION}-static`;
const IMAGE_CACHE  = `${SW_VERSION}-images`;
const API_CACHE    = `${SW_VERSION}-api`;

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  "/",
  "/style.css",
  "/script.js",
  "/offline.html",
];

// ── Install: pre-cache static assets ──────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith("cr-") && k !== STATIC_CACHE && k !== IMAGE_CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. TMDB poster/backdrop images → Cache First (images rarely change)
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, 7 * 24 * 60 * 60)); // 7 days
    return;
  }

  // 2. API calls (TMDB backend proxy) → Network First with cache fallback
  if (url.hostname.includes("vercel.app") || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE, 5 * 60)); // 5 min cache
    return;
  }

  // 3. Static assets (CSS/JS) → Cache First
  if (
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js")  ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".webp")
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 4. HTML page navigations → Network First, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline.html").then(r => r || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // 5. Everything else → Network with cache fallback
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

// ── Strategy helpers ───────────────────────────────────────────────────────

async function cacheFirst(request, cacheName, maxAgeSeconds = null) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(request);

  if (cached) {
    // Check max age if set
    if (maxAgeSeconds) {
      const dateHeader = cached.headers.get("sw-cached-at");
      if (dateHeader) {
        const age = (Date.now() - parseInt(dateHeader)) / 1000;
        if (age > maxAgeSeconds) {
          // Stale — refresh in background
          refreshCache(request, cache);
        }
      }
    }
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) putInCache(cache, request, response.clone());
    return response;
  } catch {
    return new Response("", { status: 503 });
  }
}

async function networkFirst(request, cacheName, maxAgeSeconds = null) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) putInCache(cache, request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("", { status: 503 });
  }
}

function putInCache(cache, request, response) {
  // Clone and inject a timestamp header for max-age checking
  const headers = new Headers(response.headers);
  headers.set("sw-cached-at", String(Date.now()));
  const stamped = new Response(response.body, { status: response.status, headers });
  cache.put(request, stamped);
}

async function refreshCache(request, cache) {
  try {
    const fresh = await fetch(request);
    if (fresh.ok) putInCache(cache, request, fresh);
  } catch { /* silent */ }
}
