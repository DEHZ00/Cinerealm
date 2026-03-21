/**
 * CineRealm Service Worker
 * v4 — network-first for CSS/JS so deploys propagate instantly
 */

const SW_VERSION   = "cr-v4";
const STATIC_CACHE = SW_VERSION + "-static";
const IMAGE_CACHE  = SW_VERSION + "-images";
const API_CACHE    = SW_VERSION + "-api";

const PRECACHE_URLS = ["/offline.html"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith("cr-") && ![STATIC_CACHE, IMAGE_CACHE, API_CACHE].includes(k))
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (!request.url.startsWith("http")) return;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // TMDB images — cache first (never change)
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Google fonts — cache first
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API calls — network first
  if (url.hostname.includes("vercel.app") || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // YOUR OWN CSS/JS — always network first so deploys propagate immediately
  if (/\.(css|js)$/.test(url.pathname) && url.hostname === self.location.hostname) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // Other static assets (icons, images) — cache first
  if (/\.(png|jpg|jpeg|ico|webp|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Page navigations — network first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline.html")
          .then(r => r || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }
});

async function cacheFirst(request, cacheName) {
  if (!isCacheable(request)) return fetch(request).catch(() => new Response("", { status: 503 }));
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) safeCache(cache, request, response.clone());
    return response;
  } catch { return new Response("", { status: 503 }); }
}

async function networkFirst(request, cacheName) {
  if (!isCacheable(request)) return fetch(request).catch(() => new Response("", { status: 503 }));
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) safeCache(cache, request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("", { status: 503 });
  }
}

function isCacheable(request) {
  if (request.method !== "GET") return false;
  if (!request.url.startsWith("http")) return false;
  return true;
}

function safeCache(cache, request, response) {
  if (!isCacheable(request)) return;
  if (!response || !response.ok) return;
  cache.put(request, response).catch(() => {});
}
