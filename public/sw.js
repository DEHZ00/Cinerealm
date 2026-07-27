/**
 * CineRealm Service Worker v7
 * Handles offline fallback, image caching, and FCM push notifications.
 *
 * NOTE: this is the file actually served at /sw.js (express.static serves
 * public/ first), so the FCM handlers must live here — not in a root sw.js.
 */

const SW_VERSION  = "cr-v7";
const IMAGE_CACHE = SW_VERSION + "-images";
const SHELL_CACHE = SW_VERSION + "-shell";
const OFFLINE_URL = "/offline.html";

// ── Firebase init for FCM ─────────────────────────────────────────────────
// Wrapped so a blocked/offline Firebase CDN can't fail SW installation and
// take offline support down with it. Push is a bonus; caching is the baseline.
let messaging = null;
try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

  firebase.initializeApp({
    apiKey: "AIzaSyAIRrBzdN6Rvndo5G4w6ILTa9xoJ_95VrM",
    authDomain: "cinerealm-8b7b9.firebaseapp.com",
    databaseURL: "https://cinerealm-8b7b9-default-rtdb.firebaseio.com",
    projectId: "cinerealm-8b7b9",
    storageBucket: "cinerealm-8b7b9.firebasestorage.app",
    messagingSenderId: "1076768481536",
    appId: "1:1076768481536:web:4fd3bdc3f222e4850ad3e5"
  });

  messaging = firebase.messaging();
} catch (e) {
  // Push unavailable — everything below still works.
}

// ── Background push notifications ─────────────────────────────────────────
// Handles notifications when app is in background or closed
if (messaging) {
  messaging.onBackgroundMessage(payload => {
    const { title, body, icon, url } = payload.notification || payload.data || {};
    self.registration.showNotification(title || "CineRealm", {
      body: body || "",
      icon: icon || "/android-chrome-512x512.png",
      badge: "/favicon-32x32.png",
      data: { url: url || "/" },
      actions: [
        { action: "open", title: "Open" },
        { action: "dismiss", title: "Dismiss" }
      ],
      vibrate: [200, 100, 200],
      tag: "cinerealm-notification",
      renotify: true
    });
  });
}

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing tab if open — match our own origin, not a hardcoded host,
        // so this works on localhost and preview deploys too.
        for (const client of windowClients) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.focus();
            if ("navigate" in client) client.navigate(url);
            return;
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

// ── SW lifecycle ──────────────────────────────────────────────────────────
// Precache the offline page — without this, the navigation fallback below
// always missed and users got the browser's own error page instead.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  const keep = [IMAGE_CACHE, SHELL_CACHE];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// ── Fetch handler ─────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const { request } = event;
  if (!request.url.startsWith("http")) return;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  // Cache TMDB poster images — they never change for a given path
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — network, with offline page as navigation fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () =>
        (await caches.match(OFFLINE_URL)) ||
        new Response("<h1>Offline</h1><p>CineRealm is unavailable right now.</p>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } })
      )
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
