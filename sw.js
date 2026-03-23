/**
 * CineRealm Service Worker v6
 * Handles offline fallback, image caching, and FCM push notifications
 */

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

const SW_VERSION = "cr-v6";
const IMAGE_CACHE = SW_VERSION + "-images";

// ── Firebase init for FCM ─────────────────────────────────────────────────
firebase.initializeApp({
  apiKey: "AIzaSyAIRrBzdN6Rvndo5G4w6ILTa9xoJ_95VrM",
  authDomain: "cinerealm-8b7b9.firebaseapp.com",
  databaseURL: "https://cinerealm-8b7b9-default-rtdb.firebaseio.com",
  projectId: "cinerealm-8b7b9",
  storageBucket: "cinerealm-8b7b9.firebasestorage.app",
  messagingSenderId: "1076768481536",
  appId: "1:1076768481536:web:4fd3bdc3f222e4850ad3e5"
});

const messaging = firebase.messaging();

// ── Background push notifications ─────────────────────────────────────────
// Handles notifications when app is in background or closed
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

// ── Notification click handler ────────────────────────────────────────────
self.addEventListener("notificationclick", event => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing tab if open
        for (const client of windowClients) {
          if (client.url.includes("cinerealm.online") && "focus" in client) {
            client.focus();
            client.navigate(url);
            return;
          }
        }
        // Otherwise open new tab
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

// ── SW lifecycle ──────────────────────────────────────────────────────────
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", event => {
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

// ── Fetch handler ─────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const { request } = event;
  if (!request.url.startsWith("http")) return;
  if (request.method !== "GET") return;

  let url;
  try { url = new URL(request.url); } catch { return; }

  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(request));
    return;
  }

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
