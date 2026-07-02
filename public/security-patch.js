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


let _fpLoader = null;

async function _getVisitorFingerprint() {
  try {
  
    if (!_fpLoader) {
  
      _fpLoader = (await import("https://openfpcdn.io/fingerprintjs/v4/dist/fp.esm.js")).default;
    }
    if (!_fpLoader) return null;
    
    const fp = await _fpLoader.load();
    const result = await fp.get();
    return result.visitorId;
  } catch(e) { 
    console.error("Fingerprint failed to load:", e);
    return null; 
  }
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
    // 🛑 CHANGED: Use sessionStorage so it logs on every new browser session
    // instead of skipping forever. This allows admins to clear the DB and see logs repopulate.
    const LOG_KEY = "cr_ip_logged";

    if (sessionStorage.getItem(LOG_KEY)) return;

    try {
      const [fp, ipData] = await Promise.all([_getVisitorFingerprint(), _getIPData()]);
      if (!ipData?.query || !fp) return;

      const { getDatabase, ref, get, set, update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
      const app = getApps().length ? getApps()[0] : initializeApp(FB_CONFIG);
      const db  = getDatabase(app);

      // 🛑 OPTIMIZED: Use the fingerprint as the ID! No more downloading the whole list.
      const logRef = ref(db, "ip_logs/" + fp);
      const logSnap = await get(logRef);

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

      if (logSnap.exists()) {
        // Device exists in DB, just update their latest IP and timestamp
        await update(logRef, {
          ip: ipData.query,
          country: ipData.country || null,
          city: ipData.city || null,
          uid: uid || null,
          username: username || null,
          lastSeen: Date.now()
        });
      } else {
        // 🛑 DB WAS CLEARED OR NEW DEVICE: Create new log, keyed by fingerprint!
        await set(logRef, {
          ip: ipData.query,
          country: ipData.country || null,
          city: ipData.city || null,
          proxy: ipData.proxy || false,
          hosting: ipData.hosting || false,
          uid,
          username,
          firstSeen: Date.now(),
          lastSeen: Date.now()
        });
      }

      // Save in sessionStorage so it doesn't spam on every page click this session
      sessionStorage.setItem(LOG_KEY, "1");
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
