// ══════════════════════════════════════════════════════════════════════════
// SECURITY PATCH —
// Handles: ban checks, IP logging, fingerprinting, followers/following fix
// ══════════════════════════════════════════════════════════════════════════

// ── FingerprintJS ─────────────────────────────────────────────────────────

(function() {
  const s = document.createElement("script");
  s.src = "https://openfpcdn.io/fingerprintjs/v4";
  s.async = true;
  document.head.appendChild(s);
})();

async function _getVisitorFingerprint() {
  try {

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
  try {
    const cached = sessionStorage.getItem("cr_ip_data");
    if (cached) return JSON.parse(cached);
    const res = await fetch("http://ip-api.com/json/?fields=status,query,country,city,proxy,hosting", { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
    const data = await res.json();
    if (data.status === "success") {
      
      // 🛑 Truncate IPv6 to /64 prefix to stop spam
      if (data.query && data.query.includes(":")) {
        const parts = data.query.split(":");
        data.query = parts.slice(0, 4).join(":") + "::";
      }
      
      sessionStorage.setItem("cr_ip_data", JSON.stringify(data));
      return data;
    }
  } catch(e) {}
  return null;
}
// ── Ban check — runs on every page load ──────────────────────────────────

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
   
    }
  })();
}

// ── IP Logging — logs unique IPs once per device ─────────────────────────
if (!window.location.pathname.startsWith("/banned") && !window.location.pathname.startsWith("/admin")) {
  (async function logIPOnFirstVisit() {
    const LOG_KEY = "cr_ip_logged";
    const LOG_KEY_TIME = "cr_ip_logged_time";
    const lastLogged = parseInt(localStorage.getItem(LOG_KEY_TIME) || "0");
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    if (localStorage.getItem(LOG_KEY) && (Date.now() - lastLogged < oneWeek)) return;

    try {
      const [fp, ipData] = await Promise.all([_getVisitorFingerprint(), _getIPData()]);
      if (!ipData?.query || !fp) return;

      const { getDatabase, ref, push, get, update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
      const db  = getDatabase(app);

      const logsSnap = await get(ref(db, "ip_logs"));
      let existingKey = null;
      if (logsSnap.exists()) {
        logsSnap.forEach(child => {
          if (child.val().fingerprint === fp) existingKey = child.key;
        });
      }

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

      if (existingKey) {
        await update(ref(db, "ip_logs/" + existingKey), {
          ip: ipData.query,
          country: ipData.country || null,
          city: ipData.city || null,
          uid: uid || null,
          username: username || null,
          lastSeen: Date.now()
        });
      } else {
        await push(ref(db, "ip_logs"), {
          ip: ipData.query,
          country: ipData.country || null,
          city: ipData.city || null,
          proxy: ipData.proxy || false,
          hosting: ipData.hosting || false,
          fingerprint: fp,
          uid,
          username,
          firstSeen: Date.now(),
          lastSeen: Date.now()
        });
      }

      localStorage.setItem(LOG_KEY, "1");
      localStorage.setItem(LOG_KEY_TIME, Date.now().toString());
    } catch(e) {}
  })();
}
// ── Followers / Following fix ─────────────────────────────────────────────


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
