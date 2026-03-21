/**
 * CineRealm Service Worker v5
 * Simple and reliable — server sets correct Cache-Control headers,
 * SW just handles offline fallback and image caching.
 */

const SW_VERSION = "cr-v5";
const IMAGE_CACHE = SW_VERSION + "-images";

self.addEventListener("install", event => {
  self.skipWaiting(); // activate immediately, always
});

self.addEventListener("activate", event => {
  // Delete all old caches
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== IMAGE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (!request.url.startsWith("http")) return;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Cache TMDB poster images for 7 days — they never change
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — go to network, fall back to offline page for navigation
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return new Response("", { status: 503 });
  }
}
