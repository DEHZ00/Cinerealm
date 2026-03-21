/**
 * CineRealm Service Worker v2
 */

const SW_VERSION   = "cr-v2";
const STATIC_CACHE = SW_VERSION + "-static";
const IMAGE_CACHE  = SW_VERSION + "-images";
const API_CACHE    = SW_VERSION + "-api";

const PRECACHE_URLS = ["/", "/style.css", "/script.js", "/offline.html"];

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
        keys.filter(k => k.startsWith("cr-") && ![STATIC_CACHE, IMAGE_CACHE, API_CACHE].includes(k))
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

  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  if (url.hostname.includes("vercel.app") || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (/\.(css|js|png|jpg|jpeg|ico|webp|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

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
