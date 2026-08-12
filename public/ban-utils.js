/**
 * CineRealm — shared ban/IP helpers.
 *
 * Loaded as a plain script by every page (before script.min.js) and by
 * banned.html. It exists because the ban check used to be copy-pasted into
 * script.js and banned.html, and the two copies drifted: they hashed different
 * fingerprints, fetched IP data from different providers, and wrote different
 * shapes into the same sessionStorage key. One copy, one source of truth.
 *
 * Everything here is deliberately dependency-free so banned.html — which loads
 * none of the main bundle — can use it as-is.
 */
(function (global) {
  "use strict";

  var IP_CACHE_KEY = "cr_ip_data";

  // ── IPv4 ────────────────────────────────────────────────────────────────
  function parse4(s) {
    var parts = String(s).split(".");
    if (parts.length !== 4) return null;
    var out = [];
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return null;
      var n = parseInt(parts[i], 10);
      if (n > 255) return null;
      out.push(n);
    }
    return out;
  }

  // ── IPv6 ────────────────────────────────────────────────────────────────
  // Returns the 8 groups as lowercase hex with leading zeros stripped, or null.
  // "::" is expanded, a trailing dotted-quad is folded in, and %zone / [] /
  // uppercase are all tolerated — so every spelling of one address collapses
  // to a single comparable string.
  function expand6(input) {
    var s = String(input).trim().toLowerCase();

    if (s.charAt(0) === "[") {
      var close = s.indexOf("]");
      if (close === -1) return null;
      s = s.slice(1, close);
    }
    var pct = s.indexOf("%");
    if (pct !== -1) s = s.slice(0, pct);
    if (s.indexOf(":") === -1) return null;

    // Embedded IPv4 tail (::ffff:1.2.3.4, 64:ff9b::1.2.3.4) → two hex groups.
    var m = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (m) {
      var o = parse4(m[1]);
      if (!o) return null;
      s = s.slice(0, m.index) +
          (((o[0] << 8) | o[1]).toString(16)) + ":" +
          (((o[2] << 8) | o[3]).toString(16));
    }

    var halves = s.split("::");
    if (halves.length > 2) return null;

    var head = halves[0] ? halves[0].split(":") : [];
    var groups;
    if (halves.length === 1) {
      if (head.length !== 8) return null;
      groups = head;
    } else {
      var tail = halves[1] ? halves[1].split(":") : [];
      var fill = 8 - head.length - tail.length;
      // "::" must stand in for at least one group.
      if (fill < 1) return null;
      var zeros = [];
      for (var z = 0; z < fill; z++) zeros.push("0");
      groups = head.concat(zeros, tail);
    }

    for (var i = 0; i < 8; i++) {
      if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
      groups[i] = groups[i].replace(/^0+(?=.)/, "");
    }
    return groups;
  }

  /**
   * Canonical comparable form of an address, or null if it isn't one.
   * IPv4-mapped IPv6 (::ffff:a.b.c.d) collapses to the plain IPv4 spelling so
   * the two notations for the same host compare equal.
   */
  function normalizeIp(ip) {
    if (!ip) return null;
    var s = String(ip).trim();
    if (!s || s === "Unknown_IP" || s.toLowerCase() === "unknown") return null;

    if (s.indexOf(":") === -1) {
      var o = parse4(s);
      return o ? o.join(".") : null;
    }

    var g = expand6(s);
    if (!g) return null;
    if (g[0] === "0" && g[1] === "0" && g[2] === "0" && g[3] === "0" &&
        g[4] === "0" && g[5] === "ffff") {
      var hi = parseInt(g[6], 16), lo = parseInt(g[7], 16);
      return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
    }
    return g.join(":");
  }

  /**
   * Network-level key: the /64 prefix for IPv6, the /24 for IPv4.
   *
   * This is the key that actually holds for IPv6. A v6 client rotates its
   * address within its own /64 every few hours (RFC 4941 privacy extensions),
   * so a ban on one exact address falls off by itself within a day — the
   * prefix is the part that stays put.
   */
  function networkKey(ip) {
    var norm = normalizeIp(ip);
    if (!norm) return null;
    if (norm.indexOf(":") === -1) {
      var oct = norm.split(".");
      return oct[0] + "." + oct[1] + "." + oct[2] + ".0/24";
    }
    return norm.split(":").slice(0, 4).join(":") + "::/64";
  }

  /**
   * The prefix a ban is allowed to match on — IPv6 only, deliberately.
   *
   * A /64 is one subscriber, so banning it is equivalent to banning the
   * household. A /24 is not: IPv4 is handed out from large shared pools, and
   * banning one would take out hundreds of unrelated people. IPv4 therefore
   * stays an exact-address match, which is all it needs — a v4 client does not
   * rotate through its ISP's range the way a v6 client rotates inside its /64.
   */
  function banPrefix(ip) {
    var norm = normalizeIp(ip);
    if (!norm || norm.indexOf(":") === -1) return null;
    return networkKey(norm);
  }

  function ipsEqual(a, b) {
    if (!a || !b) return false;
    var na = normalizeIp(a), nb = normalizeIp(b);
    // Both unparseable: fall back to a literal compare rather than treating
    // null === null as a match, which would ban everyone.
    if (na && nb) return na === nb;
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  function isActive(ban) {
    if (!ban) return false;
    if (ban.active === false) return false;
    if (ban.expiresAt && ban.expiresAt < Date.now()) return false;
    return true;
  }

  /**
   * Does this ban apply to the current visitor?
   * ctx: { uid, ip, network, fingerprint }
   */
  function matches(ban, ctx) {
    if (!isActive(ban)) return false;
    ctx = ctx || {};

    if (ctx.uid && ban.uid && ban.uid === ctx.uid) return true;
    if (ctx.fingerprint && ban.fingerprint && ban.fingerprint === ctx.fingerprint) return true;
    if (ctx.ip && ban.ip && ipsEqual(ban.ip, ctx.ip)) return true;

    // Prefix match, IPv6 only (see banPrefix). Bans issued before the network
    // field existed still work — the key is derived from the stored address.
    // Both sides go back through banPrefix so an IPv4 /24 sitting in either
    // record can never widen a ban.
    var banNet = banPrefix(ban.network ? String(ban.network).split("/")[0] : ban.ip);
    var ctxNet = banPrefix(ctx.network ? String(ctx.network).split("/")[0] : ctx.ip);
    if (banNet && ctxNet && banNet === ctxNet) return true;

    return false;
  }

  /**
   * The matching ban and its key, or null. Takes a Firebase snapshot.
   * When several bans match, the last one wins — push keys sort
   * chronologically, so that is the most recent one, which is the one whose
   * reason and expiry the visitor should be shown.
   */
  function findMatch(bansSnap, ctx) {
    var found = null;
    bansSnap.forEach(function (child) {
      var ban = child.val();
      if (matches(ban, ctx)) found = { ban: ban, key: child.key };
    });
    return found;
  }

  // ── Visitor IP lookup ───────────────────────────────────────────────────
  // Session-cached and shared by every page. banned.html used to run its own
  // single-provider version that wrote a thinner object into this same cache
  // key, which then silently blanked the ISP/ASN/VPN columns in the IP logs.
  function timeoutSignal(ms) {
    try {
      return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
    } catch (e) { return undefined; }
  }

  async function ipData() {
    try {
      var cached = sessionStorage.getItem(IP_CACHE_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        // Only trust the cache if it carries a usable address; a half-written
        // entry would otherwise stick for the whole session.
        if (parsed && parsed.query) return parsed;
      }
    } catch (e) {}

    var data = null;

    // Primary: ipwho.is — free, HTTPS, no key, and the only one of the three
    // that reports VPN/proxy/Tor plus ISP/ASN, so masked traffic is visible.
    try {
      var res = await fetch("https://ipwho.is/", { signal: timeoutSignal(4500) });
      var raw = await res.json();
      if (raw && raw.success !== false && raw.ip) {
        data = {
          status: "success",
          query: raw.ip,
          country: raw.country || "Unknown",
          city: raw.city || "Unknown",
          region: raw.region || null,
          isp: (raw.connection && (raw.connection.isp || raw.connection.org)) || null,
          asn: (raw.connection && raw.connection.asn != null) ? String(raw.connection.asn) : null,
          proxy: !!(raw.security && (raw.security.proxy || raw.security.vpn || raw.security.tor)),
          vpn: !!(raw.security && raw.security.vpn),
          tor: !!(raw.security && raw.security.tor),
          hosting: !!(raw.security && raw.security.hosting),
        };
      }
    } catch (e) {}

    if (!data) {
      try {
        var res2 = await fetch("https://ipapi.co/json/", { signal: timeoutSignal(4000) });
        var raw2 = await res2.json();
        if (raw2 && raw2.ip) {
          data = {
            status: "success", query: raw2.ip,
            country: raw2.country_name || "Unknown", city: raw2.city || "Unknown",
            region: raw2.region || null, isp: raw2.org || null,
            asn: raw2.asn || null,
            proxy: false, vpn: false, tor: false, hosting: false,
          };
        }
      } catch (e) {}
    }

    if (!data) {
      try {
        var res3 = await fetch("https://api.ipify.org?format=json", { signal: timeoutSignal(4000) });
        var raw3 = await res3.json();
        if (raw3 && raw3.ip) {
          data = {
            status: "success", query: raw3.ip, country: "Unknown", city: "Unknown",
            region: null, isp: null, asn: null,
            proxy: false, vpn: false, tor: false, hosting: false,
          };
        }
      } catch (e) {}
    }

    if (!data) return null;

    // Keep the full address AND the network key. Overwriting the address with
    // its own /64 (as an earlier version did) makes exact-device lookups
    // impossible; keeping only the address makes prefix bans impossible.
    data.network = networkKey(data.query);

    try { sessionStorage.setItem(IP_CACHE_KEY, JSON.stringify(data)); } catch (e) {}
    return data;
  }

  global.CRBan = {
    normalizeIp: normalizeIp,
    networkKey: networkKey,
    banPrefix: banPrefix,
    ipsEqual: ipsEqual,
    isActive: isActive,
    matches: matches,
    findMatch: findMatch,
    ipData: ipData,
    IP_CACHE_KEY: IP_CACHE_KEY,
  };
})(typeof window !== "undefined" ? window : globalThis);
