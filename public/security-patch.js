// ══════════════════════════════════════════════════════════════════════════
// SECURITY PATCH — paste this block right after FB_CONFIG in script.js
// Handles: ban checks, IP logging, fingerprinting, followers/following fix
// ══════════════════════════════════════════════════════════════════════════

// ── FingerprintJS ─────────────────────────────────────────────────────────
// Load FingerprintJS from CDN (open source, no account needed)
(function() {
  const s = document.createElement("script");
  s.src = "https://openfpcdn.io/fingerprintjs/v4";
  s.async = true;
  document.head.appendChild(s);
})();

async function _getVisitorFingerprint() {
  try {
    // Wait for FingerprintJS to load
    let attempts = 0;
    while (typeof FingerprintJS === "undefined" && attempts < 20) {
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    if (typeof FingerprintJS === "undefined") return null;
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return result.visitorId;
  } catch(e) { return null; }
}

async function _getIPData() {
  // Cache in sessionStorage so we only call ip-api once per session
  try {
    const cached = sessionStorage.getItem("cr_ip_data");
    if (cached) return JSON.parse(cached);
const res = await fetch("http://ip-api.com/json/?fields=status,query,country,city,proxy,hosting", { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
    const data = await res.json();
    if (data.status === "success") {
      sessionStorage.setItem("cr_ip_data", JSON.stringify(data));
      return data;
    }
  } catch(e) {}
  return null;
}

// ── Ban check — runs on every page load ──────────────────────────────────
// Skip on the banned page itself to avoid redirect loop
if (!window.location.pathname.startsWith("/banned")) {
  window.addEventListener("load", async function checkBanOnLoad() {
    try {
      const { getDatabase, ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
      const db  = getDatabase(app);

      const [fp, ipData] = await Promise.all([_getVisitorFingerprint(), _getIPData()]);
      const ip = ipData?.query;

      const bansSnap = await get(ref(db, "bans"));
      if (!bansSnap.exists()) return;

      // Get current user UID if logged in
      let uid = null;
      try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
        const auth = getAuth(app);
        uid = auth.currentUser?.uid || null;
      } catch(e) {}

      let isBanned = false;
      bansSnap.forEach(child => {
        const ban = child.val();
        if (ban.active === false) return;
        if (ban.expiresAt && ban.expiresAt < Date.now()) return;
        if (
          (uid && ban.uid === uid) ||
          (ip && ban.ip === ip) ||
          (fp && ban.fingerprint === fp)
        ) { isBanned = true; }
      });

      if (isBanned) window.location.href = "/banned";
    } catch(e) {
      // Silent fail — don't block site if ban check errors
    }
  })();
}

// ── IP Logging — logs unique IPs once per device ─────────────────────────
// Only runs once per device (cached in localStorage)
if (!window.location.pathname.startsWith("/banned") && !window.location.pathname.startsWith("/admin")) {
  (async function logIPOnFirstVisit() {
    const LOG_KEY = "cr_ip_logged";
    if (localStorage.getItem(LOG_KEY)) return; // already logged this device

    try {
      const [fp, ipData] = await Promise.all([_getVisitorFingerprint(), _getIPData()]);
      if (!ipData?.query) return;

      const { getDatabase, ref, push, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
      const db  = getDatabase(app);

      // Check if IP already logged
      const logsSnap = await get(ref(db, "ip_logs"));
      if (logsSnap.exists()) {
        const exists = Object.values(logsSnap.val()).some(l => l.ip === ipData.query);
        if (exists) {
          localStorage.setItem(LOG_KEY, "1");
          return;
        }
      }

      // Get username if logged in
      let uid = null, username = null;
      try {
        const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
        const auth = getAuth(app);
        uid = auth.currentUser?.uid || null;
        if (uid) {
          const pSnap = await get(ref(db, "users/" + uid + "/profile"));
          if (pSnap.exists()) username = pSnap.val().username || null;
        }
      } catch(e) {}

      await push(ref(db, "ip_logs"), {
        ip: ipData.query,
        country: ipData.country || null,
        city: ipData.city || null,
        proxy: ipData.proxy || false,
        hosting: ipData.hosting || false,
        fingerprint: fp || null,
        uid,
        username,
        firstSeen: Date.now(),
      });

      localStorage.setItem(LOG_KEY, "1");
    } catch(e) {
      // Silent fail
    }
  })();
}

// ── Followers / Following fix ─────────────────────────────────────────────
// The original followUser had a bug — it was incrementing the current user's
// follower count instead of the target user's. This patches the function.
// Paste this AFTER the original followUser / unfollowUser functions in script.js,
// or replace them entirely.

async function followUser(targetUid) {
  if (!_crUser) { openAuthModal("signin"); return; }
  if (targetUid === _crUser.uid) return;
  try {
    const { getDatabase, ref, set, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
    const db  = getDatabase(app);
    const myUid = _crUser.uid;

    // Write follow relationship
    await Promise.all([
      set(ref(db, "users/" + myUid + "/following/" + targetUid), { followedAt: Date.now() }),
      set(ref(db, "users/" + targetUid + "/followers/" + myUid), { followedAt: Date.now() }),
    ]);

    // Get actual current counts from DB (don't rely on _crProfile cache)
    const [myFollowingSnap, targetFollowersSnap] = await Promise.all([
      get(ref(db, "users/" + myUid + "/following")),
      get(ref(db, "users/" + targetUid + "/followers")),
    ]);

    const myFollowingCount     = myFollowingSnap.exists()      ? Object.keys(myFollowingSnap.val()).length      : 1;
    const targetFollowerCount  = targetFollowersSnap.exists()  ? Object.keys(targetFollowersSnap.val()).length  : 1;

    await Promise.all([
      set(ref(db, "users/" + myUid + "/profile/following"),      myFollowingCount),
      set(ref(db, "users/" + targetUid + "/profile/followers"),  targetFollowerCount),
    ]);

    // Update local profile cache
    if (_crProfile) _crProfile.following = myFollowingCount;

    showToast("Following! 👥", "success");
  } catch(e) { showToast("Failed to follow", "error"); }
}

async function unfollowUser(targetUid) {
  if (!_crUser) return;
  try {
    const { getDatabase, ref, remove, set, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
    const db  = getDatabase(app);
    const myUid = _crUser.uid;

    await Promise.all([
      remove(ref(db, "users/" + myUid + "/following/" + targetUid)),
      remove(ref(db, "users/" + targetUid + "/followers/" + myUid)),
    ]);

    // Recalculate counts from actual data
    const [myFollowingSnap, targetFollowersSnap] = await Promise.all([
      get(ref(db, "users/" + myUid + "/following")),
      get(ref(db, "users/" + targetUid + "/followers")),
    ]);

    const myFollowingCount    = myFollowingSnap.exists()     ? Object.keys(myFollowingSnap.val()).length     : 0;
    const targetFollowerCount = targetFollowersSnap.exists() ? Object.keys(targetFollowersSnap.val()).length : 0;

    await Promise.all([
      set(ref(db, "users/" + myUid + "/profile/following"),     myFollowingCount),
      set(ref(db, "users/" + targetUid + "/profile/followers"), targetFollowerCount),
    ]);

    if (_crProfile) _crProfile.following = myFollowingCount;

    showToast("Unfollowed", "info");
  } catch(e) { showToast("Failed to unfollow", "error"); }
}

async function isFollowing(targetUid) {
  if (!_crUser) return false;
  try {
    const { getDatabase, ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
    const db  = getDatabase(app);
    const snap = await get(ref(db, "users/" + _crUser.uid + "/following/" + targetUid));
    return snap.exists();
  } catch(e) { return false; }
}

// ── END SECURITY PATCH ────────────────────────────────────────────────────
