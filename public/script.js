// CineRealm script.js — v2.2
//CONFIGURATION
const BACKEND_URL = "https://ez-streaming-api.vercel.app";
const IMG_BASE = "https://image.tmdb.org/t/p/w500";

// DOM Elements
const playerDiv = document.getElementById("player");
const continueDiv = document.getElementById("continueWatching");
const loadingSpinner = document.getElementById("loadingSpinner");
const detailsModal = document.getElementById("detailsModal");
const detailsBody = document.getElementById("detailsBody");
const closeBtn = document.querySelector(".close-btn");
// ---- THEME ----
const THEME_COLOR = "#4E0000"; // main CineRealm red

// State
let historyData = [];
let watchlistData = [];
let currentlyPlaying = null;
let isLoading = false;
let currentPage = "home";
let heroItems = [];
let heroIndex = 0;
let heroTimer = null;


// ---- Local Storage Management ----
function loadHistory() {
  const raw = JSON.parse(localStorage.getItem("history") || "[]");

  // Deduplicate — keep only the most recent entry per show/movie
  // Key: type + tmdbId/id + (for TV: season+episode)
  const map = new Map();
  for (const entry of raw) {
    const id = entry.tmdbId || entry.id;
    if (!id || !entry.type) continue;
    // For TV, key per show (not per episode) so we track the latest episode watched
    const key = entry.type + "_" + id;
    const existing = map.get(key);
    if (!existing || (entry.addedAt || 0) > (existing.addedAt || 0)) {
      map.set(key, entry);
    }
  }

  historyData = Array.from(map.values());

  // If we cleaned up a lot, save the deduplicated version back
  if (raw.length > historyData.length) {
    console.log("[History] Deduplicated", raw.length, "→", historyData.length, "entries");
    saveHistory();
  }
}

function loadWatchlist() {
  watchlistData = JSON.parse(localStorage.getItem("watchlist") || "[]");
}

function saveHistory() {
  localStorage.setItem("history", JSON.stringify(historyData));
}

function saveWatchlist() {
  localStorage.setItem("watchlist", JSON.stringify(watchlistData));
}
window.addEventListener("load", () => {
  const intro = document.getElementById("appIntro");
  if (!intro) return;
  setTimeout(() => {
    intro.classList.add("fade-out");
    setTimeout(() => intro.remove(), 700);
  }, 450);
});

// ---- UI Helpers ----
function showLoading(show = true) {
  isLoading = show;
  if (loadingSpinner) {
    loadingSpinner.style.display = show ? "flex" : "none";
  }
}

// ── Toast Notifications ─────────────────────────────────────────────────────
// showToast(message, type)  type: "success" | "error" | "info"
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `cr-toast cr-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  // Trigger reflow so the CSS transition fires
  void toast.offsetWidth;
  toast.classList.add("cr-toast--visible");
  setTimeout(() => {
    toast.classList.remove("cr-toast--visible");
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}

// Keep showError as alias for backward compat (some places still call it)
function showError(message) {
  // Detect success-like messages and route correctly
  const isSuccess = /added|✓|saved|removed/i.test(message);
  showToast(message, isSuccess ? "success" : "error");
}



// --- Disclaimer  (show before first play) ---
const DISCLAIMER_KEY = "cine_disclaimer_accepted";

let pendingPlayAction = null;

function playIntroAnimation() {
  const intro = document.getElementById("appIntro");
  if (!intro) return;
  intro.classList.remove("hidden");
  setTimeout(() => intro.classList.add("hidden"), 2600);
}

function showDisclaimerThen(runAfterAccept) {
  // If already accepted, just run immediately
  const accepted = localStorage.getItem(DISCLAIMER_KEY) === "true";
  if (accepted) return runAfterAccept();

  pendingPlayAction = runAfterAccept;

  const modal = document.getElementById("disclaimerModal");
  if (!modal) {
    // Fallback: no modal on this page, just run
    return runAfterAccept();
  }

  modal.style.display = "flex";

  const acceptBtn = document.getElementById("acceptDisclaimer");
  const cancelBtn = document.getElementById("cancelDisclaimer");
  const dontShow = document.getElementById("dontShowAgain");

  // prevent stacking handlers
  acceptBtn.onclick = null;
  cancelBtn.onclick = null;

  acceptBtn.onclick = () => {
    if (dontShow && dontShow.checked) {
      localStorage.setItem(DISCLAIMER_KEY, "true");
    }
    modal.style.display = "none";
    playIntroAnimation();

    const fn = pendingPlayAction;
    pendingPlayAction = null;
    if (typeof fn === "function") fn();
  };

  cancelBtn.onclick = () => {
    modal.style.display = "none";
    pendingPlayAction = null;
  };
}




function switchPage(page) {
  currentPage = page;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(page + "Page").classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  document.getElementById(page + "Btn").classList.add("active");
  playerDiv.innerHTML = "";
  window.scrollTo(0, 0);
}

// ---- API Call Helper ----
async function apiCall(endpoint, params = {}) {
  try {
    showLoading(true);
    const queryString = new URLSearchParams(params).toString();
    const url = `${BACKEND_URL}/api/tmdb${endpoint}${queryString ? "?" + queryString : ""}`;

    console.log("API Call:", url);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    showLoading(false);
    return data;
  } catch (err) {
    console.error("API Error:", err);
    showLoading(false);
    showError("Failed to load data. Check console for details.");
    return null;
  }
}


// ---- Watchlist Management ----
function toggleWatchlist(id, type, movie) {
  let index = watchlistData.findIndex(m => m.id === id && m.type === type);
  
  if (index > -1) {
    watchlistData.splice(index, 1);
    showError("Removed from watchlist");
  } else {
    watchlistData.push({ 
      id, 
      type, 
      title: movie.title || movie.name,
      poster_path: movie.poster_path,
      addedAt: new Date().toISOString()
    });
    showError("Added to watchlist ✓");
  }
  
  saveWatchlist();
}

function isInWatchlist(id, type) {
  return watchlistData.some(m => m.id === id && m.type === type);
}

// ---- Movie/TV Card Creation ----
function createMovieCard(movie, type = "movie") {
  const card = document.createElement("div");
  card.className = "movie-card";

  if (!movie.poster_path) return null;

  let entry = historyData.find(m => m.id === movie.id && m.type === type);
  let percent = entry && entry.duration ? (entry.progress / entry.duration) * 100 : 0;
  let lastEpisodeLabel = "";
  if (type === "tv" && historyData && historyData.length) {
    const lastEntry = historyData
      .filter(e => e.type === "tv" && e.tmdbId === movie.id)
      .sort((a, b) => b.addedAt - a.addedAt)[0];
    if (lastEntry && lastEntry.season && lastEntry.episode) {
      lastEpisodeLabel = "S" + lastEntry.season + " · E" + lastEntry.episode;
    }
  }

  const title = movie.title || movie.name || "Unknown";
  const typeBadge = type === "tv" ? "TV" : (type === "anime" ? "Anime" : "Movie");
  const inWL = isInWatchlist(movie.id, type);

  card.innerHTML = `
    <div class="card-image-wrapper">
      <img src="${IMG_BASE + movie.poster_path}" alt="${title}" loading="lazy">
      <span class="card-type-badge">${typeBadge}</span>
      ${percent > 0 ? '<div class="progress-bar" style="width:' + percent + '%"></div>' : ""}
      <div class="card-hover-shine"></div>
      <p>
        ${title}
        ${lastEpisodeLabel && type === "tv" ? '<br><span class="last-episode-tag">' + lastEpisodeLabel + '</span>' : ""}
      </p>
    </div>
  `;

  // Click card → open fullscreen details
  card.addEventListener("click", () => showMovieDetails(movie, type));

  return card;
}

// ── Details Fullscreen Overlay ────────────────────────────────────────────
let detailsPanelOpen = false;

function closeDetailsPanel() {
  const panel = document.getElementById("detailsPanel");
  const overlay = document.getElementById("detailsOverlay");
  if (!panel) return;
  panel.classList.remove("panel-open");
  overlay.classList.remove("overlay-visible");
  detailsPanelOpen = false;
  // Stop trailer if playing
  const trailerIframe = document.getElementById("panelTrailerIframe");
  if (trailerIframe) trailerIframe.src = "";
  setTimeout(() => {
    panel.style.display = "none";
    overlay.style.display = "none";
  }, 320);
  document.body.style.overflow = "";
}

function openDetailsPanel() {
  const panel = document.getElementById("detailsPanel");
  const overlay = document.getElementById("detailsOverlay");
  if (!panel) return;
  panel.style.display = "flex";
  overlay.style.display = "block";
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    panel.classList.add("panel-open");
    overlay.classList.add("overlay-visible");
  });
  detailsPanelOpen = true;
}

// Keep old modal working as fallback — vars already declared at top of file

// Escape key closes panel
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && detailsPanelOpen) closeDetailsPanel();
});

async function showMovieDetails(movie, type) {
  const panel = document.getElementById("detailsPanel");

  // Use side panel if available, fallback to old modal
  if (!panel) {
    return showMovieDetailsModal(movie, type);
  }

  // Show panel immediately with skeleton
  const panelBody = document.getElementById("detailsPanelBody");
  panelBody.innerHTML = `
    <div class="panel-skeleton">
      <div class="panel-skeleton-backdrop"></div>
      <div class="panel-skeleton-content">
        <div class="panel-skel panel-skel-title"></div>
        <div class="panel-skel panel-skel-meta"></div>
        <div class="panel-skel panel-skel-overview"></div>
      </div>
    </div>
  `;
  openDetailsPanel();

  // Fetch all data in parallel
  const [data, credits, videos, similar] = await Promise.all([
    apiCall("/" + type + "/" + movie.id),
    apiCall("/" + type + "/" + movie.id + "/credits").catch(() => null),
    apiCall("/" + type + "/" + movie.id + "/videos").catch(() => null),
    apiCall("/" + type + "/" + movie.id + "/similar").catch(() => null),
  ]);

  if (!data) { closeDetailsPanel(); return; }

  const title       = data.title || data.name || "";
  const rating      = data.vote_average?.toFixed(1) || "N/A";
  const releaseYear = (data.release_date || data.first_air_date || "").split("-")[0];
  const runtime     = data.runtime
    ? Math.floor(data.runtime / 60) + "h " + (data.runtime % 60) + "m"
    : (data.episode_run_time?.[0] ? data.episode_run_time[0] + " min/ep" : "");
  const seasons     = data.number_of_seasons
    ? data.number_of_seasons + " Season" + (data.number_of_seasons > 1 ? "s" : "") : "";
  const overview    = data.overview || "No description available.";
  const backdrop    = data.backdrop_path
    ? "https://image.tmdb.org/t/p/w1280" + data.backdrop_path : "";
  const poster      = movie.poster_path
    ? IMG_BASE + movie.poster_path : "";

  const watchUrl = type === "movie"
    ? "/watch/movie/" + movie.id
    : "/watch/tv/" + movie.id + "/season/1/episode/1";

  const inWL = isInWatchlist(movie.id, type);

  // Watched state
  const watchedKey = "cr_watched_" + type + "_" + movie.id;
  const isWatched  = localStorage.getItem(watchedKey) === "1";

  // Resume banner for TV
  let resumeBanner = "";
  if (type === "tv" && historyData.length) {
    const last = historyData
      .filter(h => h.type === "tv" && h.tmdbId === movie.id && h.season && h.episode && h.progress > 30)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))[0];
    if (last) {
      const resumeUrl = "/watch/tv/" + movie.id + "/season/" + last.season + "/episode/" + last.episode;
      resumeBanner = `
        <a href="${resumeUrl}" class="panel-resume-banner">
          <span class="panel-resume-icon">▶</span>
          <div>
            <div class="panel-resume-label">Continue Watching</div>
            <div class="panel-resume-sub">S${last.season} E${last.episode} · ${formatTime(last.progress)} in</div>
          </div>
          <span class="panel-resume-arrow">→</span>
        </a>
      `;
    }
  }

  // Trailer
  const trailerKey = videos?.results?.find(v =>
    v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
  )?.key;
  const trailerBtn = trailerKey
    ? `<button class="panel-trailer-btn" id="panelTrailerBtn" data-key="${trailerKey}">🎬 Watch Trailer</button>`
    : "";

  // Cast
  const castItems = (credits?.cast || []).slice(0, 12);
  const castHTML = castItems.length ? `
    <div class="panel-section-title">Cast</div>
    <div class="panel-cast-row">
      ${castItems.map(c => `
        <div class="panel-cast-card" onclick="searchCast('${c.name.replace(/'/g, "\\'")}')">
          <img src="${c.profile_path ? IMG_BASE + c.profile_path : ""}"
               alt="${c.name}"
               class="panel-cast-img"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="panel-cast-img panel-cast-placeholder" style="display:none;">👤</div>
          <div class="panel-cast-name">${c.name}</div>
          <div class="panel-cast-char">${c.character || ""}</div>
        </div>
      `).join("")}
    </div>
  ` : "";

  // Similar titles
  const similarItems = (similar?.results || []).filter(i => i.poster_path).slice(0, 10);
  const similarHTML = similarItems.length ? `
    <div class="panel-section-title">More Like This</div>
    <div class="panel-similar-row">
      ${similarItems.map(s => `
        <div class="panel-similar-card" onclick="showMovieDetails({id:${s.id},poster_path:'${s.poster_path}',title:'${(s.title||s.name||"").replace(/'/g,"\\'")}'},'${type}')">
          <img src="${IMG_BASE + s.poster_path}" alt="${s.title || s.name}" loading="lazy">
          <div class="panel-similar-title">${s.title || s.name || ""}</div>
        </div>
      `).join("")}
    </div>
  ` : "";

  // Collections
  let collectionHTML = "";
  if (type === "movie" && data.belongs_to_collection) {
    const col = await apiCall("/collection/" + data.belongs_to_collection.id).catch(() => null);
    if (col?.parts?.length > 1) {
      const parts = col.parts.filter(p => p.poster_path).sort((a,b) => (a.release_date||"").localeCompare(b.release_date||""));
      collectionHTML = `
        <div class="panel-section-title">📚 ${col.name}</div>
        <div class="panel-similar-row">
          ${parts.map(p => `
            <div class="panel-similar-card" onclick="showMovieDetails({id:${p.id},poster_path:'${p.poster_path}',title:'${(p.title||"").replace(/'/g,"\\'")}'},'movie')">
              <img src="${IMG_BASE + p.poster_path}" alt="${p.title}" loading="lazy">
              <div class="panel-similar-title">${p.title}</div>
            </div>
          `).join("")}
        </div>
      `;
    }
  }

  panelBody.innerHTML = `
    ${backdrop ? `<div class="panel-backdrop" style="background-image:url(${backdrop})"></div>` : ""}

    <div class="panel-main">
      <div class="panel-top">
        <img src="${poster}" alt="${title}" class="panel-poster">
        <div class="panel-info">
          <h2 class="panel-title">${title}</h2>
          <div class="panel-meta">
            ${releaseYear ? `<span class="panel-chip">${releaseYear}</span>` : ""}
            ${runtime ? `<span class="panel-chip">${runtime}</span>` : ""}
            ${seasons ? `<span class="panel-chip">${seasons}</span>` : ""}
            <span class="panel-chip panel-chip-rating">⭐ ${rating}</span>
            ${isWatched ? '<span class="panel-chip panel-chip-watched">✓ Watched</span>' : ""}
          </div>
          <div class="panel-genres">
            ${(data.genres||[]).map(g => `<span class="genre-tag">${g.name}</span>`).join("")}
          </div>
          <p class="panel-overview">${overview}</p>
          <div class="panel-actions">
            <a href="${watchUrl}" class="details-play-btn">▶ Play Now</a>
            <button class="details-watchlist-btn" id="panelWatchlistBtn">
              ${inWL ? "★ In Watchlist" : "☆ Watchlist"}
            </button>
            <button class="panel-watched-btn ${isWatched ? "watched" : ""}" id="panelWatchedBtn" title="Mark as watched">
              ${isWatched ? "✓" : "○"}
            </button>
            <button class="panel-share-btn" id="panelShareBtn" title="Share">⬆</button>
          </div>
          ${trailerBtn}
        </div>
      </div>

      ${resumeBanner}

      <!-- Trailer embed (hidden until clicked) -->
      <div id="panelTrailerWrap" class="panel-trailer-wrap" style="display:none;">
        <iframe id="panelTrailerIframe" src="" allow="autoplay;fullscreen" allowfullscreen></iframe>
        <button class="panel-trailer-close" id="panelTrailerClose">✕ Close Trailer</button>
      </div>

      ${castHTML}
      ${similarHTML}
      ${collectionHTML}
    </div>
  `;

  // Wire buttons
  document.getElementById("panelWatchlistBtn").onclick = () => {
    toggleWatchlist(movie.id, type, movie);
    const btn = document.getElementById("panelWatchlistBtn");
    if (btn) btn.textContent = isInWatchlist(movie.id, type) ? "★ In Watchlist" : "☆ Watchlist";
  };

  document.getElementById("panelWatchedBtn").onclick = () => {
    const btn = document.getElementById("panelWatchedBtn");
    const nowWatched = localStorage.getItem(watchedKey) === "1";
    if (nowWatched) {
      localStorage.removeItem(watchedKey);
      btn.textContent = "○";
      btn.classList.remove("watched");
    } else {
      localStorage.setItem(watchedKey, "1");
      btn.textContent = "✓";
      btn.classList.add("watched");
    }
  };

  document.getElementById("panelShareBtn").onclick = () => {
    const shareUrl = window.location.origin + watchUrl;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast("Link copied to clipboard!", "success");
    }).catch(() => {
      showToast("Copy: " + shareUrl, "info");
    });
  };

  if (trailerKey) {
    document.getElementById("panelTrailerBtn").onclick = () => {
      const wrap   = document.getElementById("panelTrailerWrap");
      const iframe = document.getElementById("panelTrailerIframe");
      wrap.style.display = "block";
      iframe.src = "https://www.youtube.com/embed/" + trailerKey + "?autoplay=1";
      document.getElementById("panelTrailerBtn").style.display = "none";
    };
    document.getElementById("panelTrailerClose").onclick = () => {
      document.getElementById("panelTrailerWrap").style.display = "none";
      document.getElementById("panelTrailerIframe").src = "";
      document.getElementById("panelTrailerBtn").style.display = "inline-flex";
    };
  }
}

function searchCast(name) {
  window.location.href = "/search?q=" + encodeURIComponent(name);
}

// Legacy modal fallback (used if panel not in DOM)
async function showMovieDetailsModal(movie, type) {
  const data = await apiCall("/" + type + "/" + movie.id);
  if (!data) return;
  detailsModal.style.display = "flex";
}

// Close modal (legacy)
if (closeBtn) {
  closeBtn.onclick = () => { detailsModal.style.display = "none"; };
}
window.onclick = (e) => {
  if (e.target === detailsModal) detailsModal.style.display = "none";
};

// ----------------- MULTI-SOURCE PLAYER -----------------

let DEFAULT_SOURCE = "FluxLine";

/**
 * PROVIDERS
 * tier:        "standard" | "premium"  — shown as section headers in the pill bar
 * chromebook:  true if known to work on ChromeOS (no extension required)
 * supports:    which media types this source handles
 */
const PROVIDERS = [
  // ── Standard Sources ─────────────────────────────────────────────────────
  { name: "FluxLine",  key: "vidplus",    tier: "standard", chromebook: true,  sandbox: true,  supports: { movie: true, tv: true, anime: true  } }, // default
  { name: "NovaReel",  key: "spenEmbed",  tier: "standard", chromebook: true,  sandbox: false, supports: { movie: true, tv: true, anime: true  } },
  { name: "PulseView", key: "vidfast",    tier: "standard", chromebook: true,  sandbox: false, supports: { movie: true, tv: true, anime: false } },
  { name: "Ez",        key: "videasy",    tier: "standard", chromebook: true,  sandbox: false, supports: { movie: true, tv: true, anime: true  } },
  { name: "Saturn",    key: "VidSrc",     tier: "standard", chromebook: false, sandbox: false, supports: { movie: true, tv: true, anime: false } },
  { name: "Mars",      key: "vidlink",    tier: "standard", chromebook: false, sandbox: false, supports: { movie: true, tv: true, anime: false } },
  { name: "Jupiter",   key: "VidZen",     tier: "standard", chromebook: false, sandbox: true,  supports: { movie: true, tv: true, anime: true  } },
  { name: "Seenima",   key: "vidora",     tier: "standard", chromebook: false, sandbox: false, supports: { movie: true, tv: true, anime: false } },
  { name: "King",      key: "vidking",    tier: "standard", chromebook: false, sandbox: true,  supports: { movie: true, tv: true, anime: false } },

  // ── Premium Sources ───────────────────────────────────────────────────────
  { name: "VidUp",     key: "vidup",      tier: "premium",  chromebook: true,  sandbox: false, supports: { movie: true, tv: true, anime: false } },
  { name: "MoviesAPI", key: "moviesapi",  tier: "premium",  chromebook: true,  sandbox: false, supports: { movie: true, tv: true, anime: false } },
  { name: "111Movies", key: "111movies",  tier: "premium",  chromebook: true,  sandbox: false, supports: { movie: true, tv: true, anime: false } },
];


function buildQuery(params) {
  const qs = Object.entries(params || {})
    .filter(([k, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `?${qs}` : "";
}


function buildProviderUrl(providerKey, media, opts = {}) {
  const t = media.type;
  const id = media.tmdbId || media.id || (media.anilistId && t === 'anime' ? media.anilistId : '');
  if (!id) return '';

  if (providerKey === 'spenEmbed') {
    let base = '';
    if (t === 'movie') base = 'https://spencerdevs.xyz/movie/' + id;
    if (t === 'tv')    base = 'https://spencerdevs.xyz/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (t === 'anime') base = 'https://spencerdevs.xyz/anime/' + (media.anilistId||id) + '/' + (media.episode||1);
    const params = {};
    if (opts.theme || opts.color) params.theme = (opts.theme || opts.color).replace('#', '');
    return base + buildQuery(params);
  }

  if (providerKey === 'vidplus') {
    let base = '';
    if (t === 'movie') base = 'https://player.vidplus.to/embed/movie/' + id;
    if (t === 'tv')    base = 'https://player.vidplus.to/embed/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (t === 'anime') base = 'https://player.vidplus.to/embed/anime/' + (media.anilistId||id) + '/' + (media.episode||1);
    const params = {};
    if (opts.color) params.primarycolor = opts.color.replace('#','');
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? 'true' : 'false';
    if (opts.autoNext !== undefined) params.autoNext = opts.autoNext ? 'true' : 'false';
    if (opts.nextButton !== undefined) params.nextButton = opts.nextButton ? 'true' : 'false';
    if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
    if (opts.episodelist !== undefined) params.episodelist = opts.episodelist ? 'true' : 'false';
    if (opts.chromecast !== undefined) params.chromecast = opts.chromecast ? 'true' : 'false';
    if (opts.poster !== undefined) params.poster = opts.poster ? 'true' : 'false';
    if (opts.title !== undefined) params.title = opts.title ? 'true' : 'false';
    return base + buildQuery(params);
  }

  if (providerKey === 'vidfast') {
    let base = '';
    if (t === 'movie') base = 'https://vidfast.pro/movie/' + id;
    if (t === 'tv')    base = 'https://vidfast.pro/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    const params = {};
    if (opts.autoPlay !== undefined) params.autoPlay = opts.autoPlay ? 'true' : 'false';
    if (opts.theme) params.theme = opts.theme.replace('#','');
    if (opts.nextButton !== undefined) params.nextButton = opts.nextButton ? 'true' : 'false';
    if (opts.autoNext !== undefined) params.autoNext = opts.autoNext ? 'true' : 'false';
    if (opts.chromecast !== undefined) params.chromecast = opts.chromecast ? 'true' : 'false';
    if (Number.isFinite(opts.startAt) && opts.startAt > 0) params.startAt = Math.floor(opts.startAt);
    return base + buildQuery(params);
  }

  if (providerKey === 'vidking') {
    let base = '';
    if (t === 'movie') base = 'https://www.vidking.net/embed/movie/' + id;
    if (t === 'tv')    base = 'https://www.vidking.net/embed/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.color) params.color = opts.color.replace('#','');
    if (opts.autoPlay !== undefined) params.autoPlay = opts.autoPlay ? 'true' : 'false';
    if (opts.nextEpisode !== undefined) params.nextEpisode = opts.nextEpisode ? 'true' : 'false';
    if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
    return base + buildQuery(params);
  }

  if (providerKey === 'videasy') {
    let base = '';
    if (t === 'movie') base = 'https://player.videasy.net/movie/' + id;
    if (t === 'tv')    base = 'https://player.videasy.net/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (t === 'anime') base = 'https://player.videasy.net/anime/' + (media.anilistId||id) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.color) params.color = opts.color.replace('#','');
    if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
    if (opts.nextEpisode !== undefined) params.nextEpisode = opts.nextEpisode ? 'true' : 'false';
    if (opts.autoplayNextEpisode !== undefined) params.autoplayNextEpisode = opts.autoplayNextEpisode ? 'true' : 'false';
    if (opts.dub !== undefined) params.dub = opts.dub ? 'true' : 'false';
    return base + buildQuery(params);
  }

  if (providerKey === 'vidora') {
    let base = '';
    if (t === 'movie') base = 'https://vidora.su/movie/' + id;
    if (t === 'tv')    base = 'https://vidora.su/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? 'true' : 'false';
    if (opts.colour || opts.color) params.colour = (opts.colour || opts.color).replace('#','');
    if (opts.autonextepisode !== undefined) params.autonextepisode = opts.autonextepisode ? 'true' : 'false';
    return base + buildQuery(params);
  }

  if (providerKey === 'vidlink') {
    let base = '';
    if (t === 'movie') base = 'https://vidlink.pro/movie/' + id;
    if (t === 'tv')    base = 'https://vidlink.pro/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? 'true' : 'false';
    if (opts.autonextepisode !== undefined) params.autonextepisode = opts.autonextepisode ? 'true' : 'false';
    return base + buildQuery(params);
  }

  if (providerKey === 'VidZen') {
    let base = '';
    if (t === 'movie') base = 'https://vidzen.fun/movie/' + id;
    if (t === 'tv')    base = 'https://vidzen.fun/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? 'true' : 'false';
    return base + buildQuery(params);
  }

  if (providerKey === 'VidSrc') {
    let base = '';
    if (t === 'movie') base = 'https://vidsrc.cc/v3/embed/movie/' + id;
    if (t === 'tv')    base = 'https://vidsrc.cc/v3/embed/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.autoPlay !== undefined) params.autoPlay = opts.autoPlay ? 'true' : 'false';
    if (opts.poster !== undefined) params.poster = opts.poster ? 'true' : 'false';
    if (Number.isFinite(opts.startAt) && opts.startAt > 0) params.startAt = Math.floor(opts.startAt);
    return base + buildQuery(params);
  }

  if (providerKey === 'vidup') {
    let base = '';
    if (t === 'movie') base = 'https://vidup.to/movie/' + id;
    if (t === 'tv')    base = 'https://vidup.to/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.autoplay !== undefined) params.autoPlay = opts.autoplay ? 'true' : 'false';
    if (opts.title !== undefined) params.title = opts.title ? 'true' : 'false';
    if (opts.poster !== undefined) params.poster = opts.poster ? 'true' : 'false';
    if (opts.theme) params.theme = opts.theme.replace('#','');
    if (opts.chromecast !== undefined) params.chromecast = opts.chromecast ? 'true' : 'false';
    if (opts.autoNext !== undefined) params.autoNext = opts.autoNext ? 'true' : 'false';
    if (Number.isFinite(opts.startAt) && opts.startAt > 0) params.startAt = Math.floor(opts.startAt);
    return base + buildQuery(params);
  }

  if (providerKey === 'moviesapi') {
    let base = '';
    if (t === 'movie') base = 'https://moviesapi.club/movie/' + id;
    if (t === 'tv')    base = 'https://moviesapi.club/tv/' + id + '-' + (media.season||1) + '-' + (media.episode||1);
    return base;
  }

  if (providerKey === '111movies') {
    let base = '';
    if (t === 'movie') base = 'https://111movies.net/movie/' + id;
    if (t === 'tv')    base = 'https://111movies.net/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    return base;
  }

  return '';
}

// Iframe lifecycle
let currentIframe = null;
function unloadIframe() {
  if (!currentIframe) return;
  try { currentIframe.src = "about:blank"; } catch(e){/*ignore*/ }
  if (currentIframe.parentNode) currentIframe.parentNode.removeChild(currentIframe);
  currentIframe = null;
}
function insertIframe(url, useSandbox = false) {
  unloadIframe();
  if (!url) {
    showError("No playable URL for this source.");
    return null;
  }
  const iframe = document.createElement("iframe");
  iframe.id = "active-player-iframe";
  iframe.src = url;

  // Only apply sandbox on sources that support it
  if (useSandbox) {
    iframe.setAttribute("sandbox",
      "allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock"
    );
  }
  iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
  iframe.style.width = "100%";
  iframe.style.height = "600px";
  iframe.style.border = "none";
  iframe.loading = "lazy";
  iframe.addEventListener("error", () => {
    const err = document.getElementById("player-error") || document.getElementById("watch-player-error");
    if (err) err.style.display = "block";
  });
  const placeholder = 
    document.getElementById("player-iframe-placeholder") ||
    document.getElementById("watch-iframe-placeholder") ||
    playerDiv;
  if (!placeholder) {
    showError("Player container not found.");
    return null;
  }
  placeholder.innerHTML = ""; // clear previous iframe
  placeholder.appendChild(iframe);
  currentIframe = iframe;
  return iframe;
}

// ── Render Source Pills (grouped: Standard / Premium, with badges) ──────────
function renderSourcePills(media, defaultName, opts) {
  const bar = document.createElement("div");
  bar.className = "source-tabs-bar";

  // Persist last chosen provider
  const savedProvider = localStorage.getItem("cine_last_provider");
  const initialName =
    savedProvider && PROVIDERS.some(p => p.name === savedProvider && p.supports[media.type])
      ? savedProvider
      : defaultName;

  function activateProvider(providerKey, allBtns) {
    allBtns.forEach(b => b.classList.remove("active"));
    const target = allBtns.find(b => b.dataset.key === providerKey);
    if (target) {
      target.classList.add("active");
      localStorage.setItem("cine_last_provider", target.dataset.name);
    }
    const err = document.getElementById("player-error") || document.getElementById("watch-player-error");
    if (err) err.style.display = "none";
    const url = buildProviderUrl(providerKey, media, opts);
    const provider = PROVIDERS.find(p => p.key === providerKey);
    insertIframe(url, provider?.sandbox === true);
  }

  const tiers = [
    { id: "standard", label: "Sources" },
    { id: "premium",  label: "✨ Premium" },
  ];

  const allBtns = [];

  tiers.forEach(tier => {
    const group = PROVIDERS.filter(p => p.tier === tier.id && p.supports[media.type]);
    if (!group.length) return;

    // Section label
    const sectionLabel = document.createElement("div");
    sectionLabel.className = `source-section-label source-section-${tier.id}`;
    sectionLabel.textContent = tier.label;
    bar.appendChild(sectionLabel);

    // Pill row for this tier
    const row = document.createElement("div");
    row.className = "source-tabs-scroll";
    bar.appendChild(row);

    group.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "source-tab";
      btn.type = "button";
      btn.dataset.key  = p.key;
      btn.dataset.name = p.name;

      if (p.tier === "premium") btn.classList.add("source-tab--premium");
      if (p.name === initialName) btn.classList.add("active");

      // Inner layout: name + badges
      const nameSpan = document.createElement("span");
      nameSpan.textContent = p.name;
      btn.appendChild(nameSpan);

      if (p.chromebook) {
        const badge = document.createElement("span");
        badge.className = "source-badge source-badge--cb";
        badge.title = "Works on Chromebook";
        badge.textContent = "CB";
        btn.appendChild(badge);
      }

      btn.addEventListener("click", () => activateProvider(p.key, allBtns));
      row.appendChild(btn);
      allBtns.push(btn);
    });
  });

  // Chromebook legend hint (one-time, dismissable)
  if (!localStorage.getItem("cr_cb_legend_seen")) {
    const legend = document.createElement("div");
    legend.className = "source-legend";
    legend.innerHTML = `<span class="source-badge source-badge--cb">CB</span> = Confirmed working on Chromebook &nbsp;·&nbsp; <button class="source-legend-dismiss">Got it</button>`;
    legend.querySelector(".source-legend-dismiss").onclick = () => {
      legend.remove();
      localStorage.setItem("cr_cb_legend_seen", "1");
    };
    bar.appendChild(legend);
  }

  return bar;
}


// Unified loadPlayer you call from cards
function loadPlayer(id, type = "movie", title = "", extraOpts = {}) {
  const media = {
    type,
    tmdbId: id,
    season: extraOpts.season,
    episode: extraOpts.episode,
    anilistId: extraOpts.anilistId
  };

  const lastProgress = getHistoryProgress(id, type, extraOpts.season, extraOpts.episode);


  // render player wrapper
  playerDiv.innerHTML = `
    <div class="player-wrapper">
      <div class="player-header">
        <h3>${title || ""}</h3>
        <span class="player-type">${type === "tv" ? "TV Show" : (type === "anime" ? "Anime" : "Movie")}</span>
      </div>
      <div id="player-season-dropdown"></div>
      <div id="player-tabs-placeholder"></div>
      <div id="player-iframe-placeholder" class="iframe-placeholder"></div>
      <div id="player-error" style="display:none; padding:14px; text-align:center; color:#ff6b6b;">
        <p>⚠️ This source failed to load. Try another source above.</p>
      </div>
    </div>
  `;

  // render season dropdown for TV
  if (type === "tv") {
    renderSeasonsDropdown(id, media, extraOpts);
  }

  // Build options object for provider mapping
  const opts = {
    color: extraOpts.color || "#ffffff",
    colour: extraOpts.color || "#ffffff",
    autonextepisode: extraOpts.autoplayNextEpisode ?? true,

    theme: extraOpts.theme || "#ffffff",
    autoplay: extraOpts.autoplay ?? true,
    autoNext: extraOpts.autoNext ?? true,
    autoplayNextEpisode: extraOpts.autoplayNextEpisode ?? true,
    nextButton: extraOpts.nextButton ?? true,
    episodeSelector: extraOpts.episodeSelector ?? true,
    overlay: extraOpts.overlay ?? true,
    dub: extraOpts.dub ?? true,
    poster: extraOpts.poster ?? true,
    title: extraOpts.title ?? true,
    icons: extraOpts.icons ?? "true",
    servericon: extraOpts.servericon ?? true,
    chromecast: extraOpts.chromecast ?? true,
    hideServerControls: extraOpts.hideServerControls ?? false,
    fullscreenButton: extraOpts.fullscreenButton ?? true,
    progress: extraOpts.progress ?? 0,
    startAt: extraOpts.startAt ?? 0,
    server: extraOpts.server ?? undefined,
    fontcolor: extraOpts.fontcolor ?? undefined,
    fontsize: extraOpts.fontsize ?? undefined,
    progress: lastProgress ?? 0,
    opacity: extraOpts.opacity ?? undefined
  };

  // Render provider pills
  const tabs = renderSourcePills(media, DEFAULT_SOURCE, opts);
  document.getElementById("player-tabs-placeholder").appendChild(tabs);

  const activeBtn = tabs.querySelector(".source-tab.active") || tabs.querySelector(".source-tab");
  if (activeBtn) activeBtn.click();

  currentlyPlaying = { id, type, title, media, opts };
  setTimeout(() => playerDiv.scrollIntoView({ behavior: "smooth" }), 80);
}


// ── Row scroll arrows ─────────────────────────────────────────────────────
function addRowScrollArrows(row) {
  if (!row || row.dataset.arrowsAdded) return;
  const section = row.closest("section");
  if (!section) return;

  // Wrap row in a scroll container if not already wrapped
  const existing = section.querySelector(".row-scroll-wrap");
  if (existing) return;

  const wrap = document.createElement("div");
  wrap.className = "row-scroll-wrap";

  const leftBtn = document.createElement("button");
  leftBtn.className = "row-arrow row-arrow-left";
  leftBtn.innerHTML = "&#8249;";
  leftBtn.setAttribute("aria-label", "Scroll left");

  const rightBtn = document.createElement("button");
  rightBtn.className = "row-arrow row-arrow-right";
  rightBtn.innerHTML = "&#8250;";
  rightBtn.setAttribute("aria-label", "Scroll right");

  // Insert wrap around the row
  row.parentNode.insertBefore(wrap, row);
  wrap.appendChild(leftBtn);
  wrap.appendChild(row);
  wrap.appendChild(rightBtn);

  const SCROLL_AMT = 600;
  leftBtn.addEventListener("click", () => row.scrollBy({ left: -SCROLL_AMT, behavior: "smooth" }));
  rightBtn.addEventListener("click", () => row.scrollBy({ left: SCROLL_AMT, behavior: "smooth" }));

  // Show/hide arrows based on scroll position
  function updateArrows() {
    leftBtn.style.opacity  = row.scrollLeft > 10 ? "1" : "0.3";
    leftBtn.style.pointerEvents = row.scrollLeft > 10 ? "auto" : "none";
    const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 10;
    rightBtn.style.opacity = atEnd ? "0.3" : "1";
    rightBtn.style.pointerEvents = atEnd ? "none" : "auto";
  }
  row.addEventListener("scroll", updateArrows, { passive: true });
  updateArrows();

  row.dataset.arrowsAdded = "1";
}

// ── Re-run personal rows when returning to the page ───────────────────────
function refreshPersonalRows() {
  // Only run on home page — these elements don't exist on other pages
  if (!document.getElementById("continueWatching")) return;
  loadHistory();
  renderContinueWatching();
  loadBecauseYouWatched();
}

// pageshow fires on back/forward navigation (bfcache restore)
window.addEventListener("pageshow", (e) => {
  if (e.persisted) refreshPersonalRows();
});

// visibilitychange fires when switching tabs
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshPersonalRows();
});

// Also refresh when window regains focus
window.addEventListener("focus", refreshPersonalRows);
function showSkeletons(container, count = 8) {
  container.innerHTML = Array(count).fill(
    '<div class="skeleton-card"><div class="skeleton-card-img"></div><div class="skeleton-card-title"></div></div>'
  ).join("");
}

async function fetchMovies(endpoint, containerId, type = "movie") {
  const container = document.getElementById(containerId);
  if (!container) return;

  showSkeletons(container);
  const data = await apiCall(endpoint);

  if (!data || !data.results) {
    container.innerHTML = `<p class="placeholder">No content found</p>`;
    return;
  }

  container.innerHTML = "";
  data.results
    .filter(item => item.poster_path)
    .slice(0, 40)
    .forEach(item => {
      const card = createMovieCard(item, type);
      if (card) container.appendChild(card);
    });

  addRowScrollArrows(container);
}

  // Show options

 // ---- Render Seasons & Episodes Dropdown ----
async function renderSeasonsDropdown(tvId, media, extraOpts = {}) {
  const container = document.getElementById("player-season-dropdown");
  if (!container) return;

  container.innerHTML = "";

  const tvData = await apiCall(`/tv/${tvId}`);
  if (!tvData || !tvData.seasons) return;

  // Filter out specials (season 0)
  const seasons = tvData.seasons.filter(s => s.season_number > 0);
  if (!seasons.length) return;

  // --- Create Season Dropdown ---
  const seasonSelect = document.createElement("select");
  seasonSelect.className = "season-select";
  seasonSelect.innerHTML = seasons
    .map(s => `<option value="${s.season_number}">Season ${s.season_number} - ${s.name || ""}</option>`)
    .join("");

  container.appendChild(seasonSelect);

  // --- Create Episode Row ---
  const wrapper = document.createElement("div");
  wrapper.className = "episode-row-wrapper";

  const leftBtn = document.createElement("button");
  leftBtn.className = "scroll-btn left";
  leftBtn.textContent = "◀";

  const rightBtn = document.createElement("button");
  rightBtn.className = "scroll-btn right";
  rightBtn.textContent = "▶";

  const episodeList = document.createElement("div");
  episodeList.className = "episode-list";

  wrapper.appendChild(leftBtn);
  wrapper.appendChild(episodeList);
  wrapper.appendChild(rightBtn);
  container.appendChild(wrapper);

  // scroll buttons
  leftBtn.addEventListener("click", () => {
    episodeList.scrollBy({ left: -300, behavior: "smooth" });
  });
  rightBtn.addEventListener("click", () => {
    episodeList.scrollBy({ left: 300, behavior: "smooth" });
  });

  // Season data cache — avoids re-fetching when user switches back
  const seasonCache = {};

  // --- Load Episodes for a Season ---
  async function loadEpisodes(seasonNumber) {
    const cacheKey = `${tvId}_s${seasonNumber}`;
    let seasonData = seasonCache[cacheKey];

    if (!seasonData) {
      seasonData = await apiCall(`/tv/${tvId}/season/${seasonNumber}`);
      if (seasonData) seasonCache[cacheKey] = seasonData;
    }

    episodeList.innerHTML = "";
    if (!seasonData || !seasonData.episodes) return;

    seasonData.episodes.forEach(ep => {
      const epDiv = document.createElement("div");
      epDiv.className = "episode-card";

      const epProgress = getHistoryProgress(tvId, "tv", seasonNumber, ep.episode_number);
      const resumeBadge = epProgress > 0
        ? `<span class="resume-badge">Resume at ${formatTime(epProgress)}</span>`
        : "";

      // Check if this is the currently playing episode
      const isPlaying = extraOpts.season === seasonNumber && extraOpts.episode === ep.episode_number;
      if (isPlaying) epDiv.classList.add("playing-episode");

      // Progress bar percentage
      const epData = historyData.find(h =>
        h.type === "tv" && h.tmdbId === tvId &&
        h.season === seasonNumber && h.episode === ep.episode_number
      );
      const pct = epData && epData.duration ? Math.min(100, (epData.progress / epData.duration) * 100) : 0;
      const progressBar = pct > 0
        ? `<div class="episode-progress-bar"><div class="episode-progress-fill" style="width:${pct}%"></div></div>`
        : "";

      epDiv.innerHTML = `
        <div style="position:relative;">
          <img src="${ep.still_path ? IMG_BASE + ep.still_path : ""}" alt="${ep.name}" class="episode-poster">
          ${isPlaying ? '<div class="episode-now-playing-badge">▶ Playing</div>' : ""}
          ${progressBar}
        </div>
        <div class="episode-info">
          <strong>${ep.episode_number}. ${ep.name}</strong>
          ${resumeBadge}
          <p>${ep.overview || ""}</p>
        </div>
      `;

      epDiv.addEventListener("click", () => {
        const lastProgress = getHistoryProgress(tvId, "tv", seasonNumber, ep.episode_number);

        // Remove playing class from all cards, add to clicked
        episodeList.querySelectorAll(".episode-card").forEach(c => {
          c.classList.remove("playing-episode");
          const badge = c.querySelector(".episode-now-playing-badge");
          if (badge) badge.remove();
        });
        epDiv.classList.add("playing-episode");

        // Update browser URL without reloading
        const newUrl = "/watch/tv/" + tvId + "/season/" + seasonNumber + "/episode/" + ep.episode_number;
        history.pushState({ tvId, seasonNumber, episode: ep.episode_number }, "", newUrl);

        // Update extraOpts so highlight stays correct
        extraOpts.season  = seasonNumber;
        extraOpts.episode = ep.episode_number;

        loadPlayer(tvId, "tv", media.title || media.name || "", {
          ...extraOpts,
          season: seasonNumber,
          episode: ep.episode_number,
          progress: lastProgress
        });
      });

      episodeList.appendChild(epDiv);

      // Auto-scroll to playing episode after render
      if (isPlaying) {
        setTimeout(() => epDiv.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }), 150);
      }
    });
  }

  // Season dropdown change → load episodes for selected season
  seasonSelect.addEventListener("change", (e) => {
    const chosen = parseInt(e.target.value, 10);
    // Update URL to reflect season change
    const newUrl = "/watch/tv/" + tvId + "/season/" + chosen + "/episode/1";
    history.pushState({ tvId, seasonNumber: chosen, episode: 1 }, "", newUrl);
    loadEpisodes(chosen);
  });

  // 🔑 Initial season: use extraOpts.season if present, otherwise first season
  const initialSeason = extraOpts.season || seasons[0].season_number;
  seasonSelect.value = initialSeason;
  loadEpisodes(initialSeason);
}




function getHistoryProgress(tmdbId, type, season, episode) {
  if (!historyData || !Array.isArray(historyData)) return 0;

  const match = historyData.find((item) => {
    if (item.type !== type || item.tmdbId !== tmdbId) return false;
    if (type === "tv") {
      return item.season === season && item.episode === episode;
    }
    return true;
  });

  return match ? match.progress || 0 : 0;
}


function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2,"0")}:${sec.toString().padStart(2,"0")}` : `${m}:${sec.toString().padStart(2,"0")}`;
}


// ---- Render Continue Watching ----
async function renderContinueWatching() {
  const container = document.getElementById("continueWatching");
  if (!container) return;

  container.innerHTML = "";

  if (!Array.isArray(historyData) || historyData.length === 0) {
    container.innerHTML = `<p class="placeholder">You haven't watched anything yet. Start watching to see it here!</p>`;
    return;
  }

  // Sort newest first
  const sorted = [...historyData].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  const seen = new Set();
  const compact = [];

  for (const item of sorted) {
    if (!item || !item.type) continue;
    const id = item.tmdbId || item.id;
    if (!id) continue;

    // Include item if: has real progress, OR was recently visited (within 30 days)
    const hasProgress = item.progress > 30; // more than 30 seconds watched
    const isFinished = item.progress && item.duration && item.progress >= item.duration - 60;
    const isRecent = (Date.now() - (item.addedAt || 0)) < 30 * 24 * 60 * 60 * 1000;

    if (isFinished) continue; // skip fully watched
    if (!hasProgress && !isRecent) continue; // skip entries with no progress and not recent

    const key = item.type + "-" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    compact.push({ ...item, tmdbId: id });

    if (compact.length >= 20) break;
  }

  if (compact.length === 0) {
    container.innerHTML = `<p class="placeholder">No movies or shows to continue. Start watching to see them here!</p>`;
    return;
  }  for (const entry of compact) {
    try {
      const type = entry.type || "movie";
      const tmdbId = entry.tmdbId;

      const data = await apiCall(`/${type}/${tmdbId}`);
      if (!data) continue;

      const card = createMovieCard(data, type);
      if (!card) continue;

      const label = card.querySelector("p");
      if (label && entry.progress) {
        label.innerHTML += `<br><span class="resume-badge">Resume at ${formatTime(entry.progress)}</span>`;
      }

      container.appendChild(card);
    } catch (err) {
      console.error("Failed to build continue-watching card:", err);
    }
  }
  addRowScrollArrows(container);
}




// ---- Render Watchlist Page ----
async function renderWatchlist() {
  const container = document.getElementById("watchlistContent");
  container.innerHTML = "";

  if (watchlistData.length === 0) {
    container.innerHTML = `<p class="placeholder">Your watchlist is empty. Add movies or shows to watch later!</p>`;
    return;
  }

  for (const item of watchlistData) {
    try {
      const data = await apiCall(`/${item.type}/${item.id}`);
      if (data) {
        const card = createMovieCard(data, item.type);
        if (card) container.appendChild(card);
      }
    } catch (err) {
      console.error("Failed to fetch watchlist item:", err);
    }
  }
}

// ---- Render Trending Page ----
async function renderTrending() {
  const container = document.getElementById("trendingContent");
  
  const movieData = await apiCall("/trending/movie/week");
  const tvData = await apiCall("/trending/tv/week");

  container.innerHTML = "";

  if (movieData && movieData.results) {
    movieData.results
      .filter(item => item.poster_path)
      .slice(0, 10)
      .forEach(item => {
        const card = createMovieCard(item, "movie");
        if (card) container.appendChild(card);
      });
  }

  if (tvData && tvData.results) {
    tvData.results
      .filter(item => item.poster_path)
      .slice(0, 10)
      .forEach(item => {
        const card = createMovieCard(item, "tv");
        if (card) container.appendChild(card);
      });
  }
}

// ---- Search Movies & TV ----

// ── Section 5 — Search V2 ─────────────────────────────────────────────────

const sb = document.getElementById("searchBar");

// Search history helpers
const SEARCH_HISTORY_KEY = "cr_search_history";
function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || "[]"); } catch { return []; }
}
function addSearchHistory(q) {
  if (!q || q.length < 2) return;
  let h = getSearchHistory().filter(s => s !== q);
  h.unshift(q);
  h = h.slice(0, 8);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h));
}
function removeSearchHistory(q) {
  const h = getSearchHistory().filter(s => s !== q);
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h));
}

// Create live dropdown container (attached to header)
function createSearchDropdown() {
  let d = document.getElementById("searchDropdown");
  if (d) return d;
  d = document.createElement("div");
  d.id = "searchDropdown";
  d.className = "search-dropdown";
  // Insert right after the header element
  const header = document.querySelector("header");
  if (header) header.parentNode.insertBefore(d, header.nextSibling);
  else document.body.appendChild(d);
  return d;
}

function closeSearchDropdown() {
  const d = document.getElementById("searchDropdown");
  if (d) d.style.display = "none";
}

function showSearchHistory() {
  const d = createSearchDropdown();
  const history = getSearchHistory();
  if (!history.length) { d.style.display = "none"; return; }

  d.innerHTML = `
    <div class="sdrop-section-label">Recent Searches</div>
    ${history.map(q => `
      <div class="sdrop-history-item">
        <span class="sdrop-history-icon">🕐</span>
        <span class="sdrop-history-text" data-q="${q}">${q}</span>
        <button class="sdrop-history-remove" data-q="${q}">✕</button>
      </div>
    `).join("")}
  `;

  d.querySelectorAll(".sdrop-history-text").forEach(el => {
    el.onclick = () => {
      sb.value = el.dataset.q;
      closeSearchDropdown();
      window.location.href = "/search?q=" + encodeURIComponent(el.dataset.q);
    };
  });

  d.querySelectorAll(".sdrop-history-remove").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      removeSearchHistory(btn.dataset.q);
      showSearchHistory();
    };
  });

  // Position dropdown under search bar
  positionDropdown(d);
  d.style.display = "block";
}

function positionDropdown(d) {
  if (!sb) return;
  const rect = sb.getBoundingClientRect();
  d.style.position = "fixed";
  d.style.top = (rect.bottom + 6) + "px";
  d.style.left = rect.left + "px";
  d.style.width = Math.max(rect.width, 320) + "px";
}

// Debounced live search
let _searchDebounce = null;

function startLiveSearch(query) {
  clearTimeout(_searchDebounce);
  if (!query || query.length < 2) {
    showSearchHistory();
    return;
  }
  _searchDebounce = setTimeout(() => runLiveSearch(query), 400);
}

async function runLiveSearch(query) {
  const d = createSearchDropdown();
  positionDropdown(d);
  d.style.display = "block";
  d.innerHTML = '<div class="sdrop-loading">Searching…</div>';

  const data = await apiCall("/search/multi", { query, page: 1 });
  const results = (data?.results || [])
    .filter(x => (x.media_type === "movie" || x.media_type === "tv") && (x.poster_path || x.backdrop_path))
    .slice(0, 6);

  if (!results.length) {
    d.innerHTML = `<div class="sdrop-empty">No results for "<strong>${query}</strong>"</div>`;
    return;
  }

  d.innerHTML = `
    <div class="sdrop-section-label">Results</div>
    ${results.map(r => {
      const title = r.title || r.name || "";
      const year  = (r.release_date || r.first_air_date || "").split("-")[0];
      const type  = r.media_type === "tv" ? "TV" : "Movie";
      const img   = r.poster_path ? IMG_BASE + r.poster_path : "";
      return `
        <div class="sdrop-result" data-id="${r.id}" data-type="${r.media_type}" data-poster="${r.poster_path || ""}" data-title="${title.replace(/"/g, "&quot;")}">
          ${img ? `<img src="${img}" alt="${title}" class="sdrop-poster">` : '<div class="sdrop-poster sdrop-poster-empty">🎬</div>'}
          <div class="sdrop-info">
            <div class="sdrop-title">${title}</div>
            <div class="sdrop-meta">${year ? year + " · " : ""}${type}</div>
          </div>
        </div>
      `;
    }).join("")}
    <a class="sdrop-see-all" href="/search?q=${encodeURIComponent(query)}">See all results for "${query}" →</a>
  `;

  d.querySelectorAll(".sdrop-result").forEach(el => {
    el.onclick = () => {
      addSearchHistory(query);
      closeSearchDropdown();
      const movie = { id: parseInt(el.dataset.id), poster_path: el.dataset.poster, title: el.dataset.title, name: el.dataset.title };
      showMovieDetails(movie, el.dataset.type);
    };
  });
}

if (sb) {
  // Live search on input
  sb.addEventListener("input", (e) => {
    const q = sb.value.trim();
    startLiveSearch(q);
  });

  // Show history on focus
  sb.addEventListener("focus", () => {
    const q = sb.value.trim();
    if (!q) showSearchHistory();
    else startLiveSearch(q);
  });

  // Navigate to search page on Enter
  sb.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = sb.value.trim();
      if (!q) return;
      addSearchHistory(q);
      closeSearchDropdown();
      window.location.href = "/search?q=" + encodeURIComponent(q);
    }
    if (e.key === "Escape") closeSearchDropdown();
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (!sb.contains(e.target) && !document.getElementById("searchDropdown")?.contains(e.target)) {
      closeSearchDropdown();
    }
  });
}


function buildHeroDots() {
  const dotsContainer = document.getElementById("heroDots");
  if (!dotsContainer || !heroItems.length) return;

  dotsContainer.innerHTML = "";
  heroItems.forEach((_, idx) => {
    const dot = document.createElement("div");
    dot.className = "hero-dot" + (idx === heroIndex ? " active" : "");
    dot.addEventListener("click", () => {
      heroIndex = idx;
      showHeroSlide(heroIndex);
      if (heroTimer) {
        clearInterval(heroTimer);
        heroTimer = setInterval(nextHeroSlide, 12000);
      }
    });
    dotsContainer.appendChild(dot);
  });
}

function showHeroSlide(index) {
  if (!heroItems.length) return;
  const movie = heroItems[index];
  const heroBg       = document.getElementById("heroBg");
  const heroTitle    = document.getElementById("heroTitle");
  const heroOverview = document.getElementById("heroOverview");
  const dotsContainer = document.getElementById("heroDots");

  if (!heroBg || !heroTitle || !heroOverview) return;

  heroBg.style.backgroundImage = "url(" + IMG_BASE.replace("/w500", "/w1280") + movie.backdrop_path + ")";

  // Title works for both movie (title) and tv (name)
  const displayTitle = movie.title || movie.name || "Trending Now";
  const mediaType    = movie.media_type || (movie.title ? "movie" : "tv");
  const typeBadge    = mediaType === "tv" ? "TV Show" : "Movie";

  heroTitle.innerHTML = displayTitle + ' <span style="font-size:13px;font-weight:600;background:rgba(255,44,44,0.85);color:#fff;padding:3px 10px;border-radius:999px;vertical-align:middle;letter-spacing:0.5px;">' + typeBadge + '</span>';
  heroOverview.textContent = movie.overview || "";

  // Update dots
  if (dotsContainer) {
    dotsContainer.querySelectorAll(".hero-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  // Buttons
  const playBtn = document.getElementById("heroPlayBtn");
  const moreBtn = document.getElementById("heroMoreBtn");

  if (playBtn) {
    playBtn.onclick = () => {
      if (mediaType === "tv") {
        window.location.href = "/watch/tv/" + movie.id + "/season/1/episode/1";
      } else {
        window.location.href = "/watch/movie/" + movie.id;
      }
    };
  }

  if (moreBtn) {
    moreBtn.onclick = () => showMovieDetails(movie, mediaType);
  }
}

function nextHeroSlide() {
  if (!heroItems.length) return;
  heroIndex = (heroIndex + 1) % heroItems.length;
  showHeroSlide(heroIndex);
}

async function initHeroCarousel() {
  const heroSection = document.getElementById("heroSection");
  if (!heroSection) return;

  // Fetch both trending movies and TV, merge and shuffle
  const [movieData, tvData] = await Promise.all([
    apiCall("/trending/movie/week"),
    apiCall("/trending/tv/week")
  ]);

  const movies = (movieData?.results || []).filter(m => m.backdrop_path).slice(0, 4).map(m => ({ ...m, media_type: "movie" }));
  const shows  = (tvData?.results  || []).filter(m => m.backdrop_path).slice(0, 3).map(m => ({ ...m, media_type: "tv"    }));

  // Interleave: movie, tv, movie, tv...
  const merged = [];
  const maxLen = Math.max(movies.length, shows.length);
  for (let i = 0; i < maxLen; i++) {
    if (movies[i]) merged.push(movies[i]);
    if (shows[i])  merged.push(shows[i]);
  }

  heroItems = merged.slice(0, 6);

  if (!heroItems.length) {
    heroSection.style.display = "none";
    return;
  }

  heroIndex = 0;
  buildHeroDots();
  showHeroSlide(0);

  if (heroTimer) clearInterval(heroTimer);
  heroTimer = setInterval(nextHeroSlide, 12000);
}

// ---- Navigation ----
const homeLink = document.getElementById("homeLink");
if (homeLink) {
  homeLink.addEventListener("click", () => switchPage("home"));
}


document.querySelectorAll(".nav-btn[data-page]").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const page = btn.dataset.page;
    if (!page) return;

    switchPage(page);

    if (page === "watchlist") renderWatchlist();
    if (page === "trending") renderTrending();
  });
});




// ---- Unified PLAYER_EVENT handler (Vidking, etc) ----
window.addEventListener("message", function (event) {
  try {
    let msg = event.data;
    if (typeof msg === "string") {
      try {
        msg = JSON.parse(msg);
      } catch {
        return;
      }
    }

    if (!msg || msg.type !== "PLAYER_EVENT" || !msg.data) return;

    const {
      currentTime,
      duration,
      id,
      mediaType,
      season,
      episode,
      event: evtName
    } = msg.data;

    const tmdbId = parseInt(id, 10);
    if (!tmdbId || !mediaType) return;

    // Find existing entry for this show/movie — for TV match by show ID only
    // (we always update the single entry per show to track latest episode)
    let entry = historyData.find((m) => {
      if (m.type !== mediaType) return false;
      const entryId = m.tmdbId || m.id;
      return String(entryId) === String(tmdbId);
    });

    if (!entry) {
      entry = {
        tmdbId,
        type: mediaType,
        progress: 0,
        duration: 0,
        addedAt: Date.now(),
      };
      historyData.push(entry);
    }

    // Always update to latest episode for TV
    if (mediaType === "tv") {
      entry.season  = season;
      entry.episode = episode;
    }

    entry.progress = currentTime || 0;
    entry.duration = duration || 0;
    entry.addedAt = Date.now();
    saveHistory();

    // Re-render row when an episode fully ends
    if (evtName === "ended") {
      renderContinueWatching();
    }
  } catch (e) {
    // ignore
  }
});


window.addEventListener("message", function (event) {
  try {
    const msg = event.data;

    if (!msg || msg.type !== "MEDIA_DATA" || !msg.data) return;

    const mediaData = msg.data;

 
    const id = mediaData.id;
    const mediaType = mediaData.type;

    
    const watched = mediaData.progress?.watched ?? mediaData.progress?.watchedTime ?? mediaData.progress?.time ?? 0;
    const duration = mediaData.progress?.duration ?? 0;

    let entry = historyData.find(m => {
      const entryId = m.tmdbId || m.id;
      return String(entryId) === String(id) && m.type === mediaType;
    });

    if (!entry) {
      entry = { tmdbId: isNaN(Number(id)) ? id : Number(id), type: mediaType, progress: 0, duration: 0, addedAt: Date.now() };
      historyData.push(entry);
    }

    entry.progress = watched;
    entry.duration = duration;
    entry.addedAt = Date.now();
    saveHistory();

  } catch (e) {
    // ignore
  }
});
if (document.getElementById("heroSection")) {
  initHeroCarousel();
}



// ── Transparent-to-solid header on scroll ─────────────────────────────────
(function() {
  const hdr = document.querySelector("header");
  if (!hdr) return;
  function onScroll() {
    if (window.scrollY > 40) hdr.classList.add("scrolled");
    else hdr.classList.remove("scrolled");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

// ── Service Worker Registration ────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then(reg => {
        console.log("CineRealm SW registered:", reg.scope);

        // Force new SW to activate immediately without waiting for tabs to close
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New SW installed — force activate and reload once
              newWorker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(err => console.warn("SW registration failed:", err));

    // When SW takes control, reload once to get fresh assets
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

// ── Mobile nav hamburger ──────────────────────────────────────────────────
(function() {
  const header = document.querySelector("header");
  if (!header) return;

  // Add hamburger button into header
  const hamburger = document.createElement("button");
  hamburger.className = "nav-hamburger";
  hamburger.innerHTML = "☰";
  hamburger.title = "Menu";
  header.appendChild(hamburger);

  // Build drawer from existing nav links
  const navLinks = document.querySelector(".nav-links");
  const links = navLinks ? Array.from(navLinks.querySelectorAll("a")) : [];

  const overlay = document.createElement("div");
  overlay.className = "nav-drawer-overlay";
  document.body.appendChild(overlay);

  const drawer = document.createElement("nav");
  drawer.className = "nav-drawer";
  drawer.innerHTML = `
    <button class="nav-drawer-close">✕</button>
    <div style="padding:12px 24px 20px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:8px;">
      <span style="font-size:16px;font-weight:900;color:#ff2c2c;">🎬 Cine Realm</span>
    </div>
    ${links.map(a => `<a href="${a.href}" class="${a.className}">${a.textContent}</a>`).join("")}
  `;
  document.body.appendChild(drawer);

  function openDrawer() {
    drawer.classList.add("open");
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    overlay.classList.remove("open");
    document.body.style.overflow = "";
  }

  hamburger.onclick = openDrawer;
  overlay.onclick = closeDrawer;
  drawer.querySelector(".nav-drawer-close").onclick = closeDrawer;
})();

// ── Dynamic page title while watching ────────────────────────────────────
function updatePageTitle(title, isPlaying) {
  if (isPlaying) {
    document.title = "▶ " + title + " — CineRealm";
  } else {
    document.title = title + " — CineRealm";
  }
}

// ── Handle browser back/forward for episode navigation ────────────────────
window.addEventListener("popstate", (e) => {
  if (!e.state) return;
  const { tvId, seasonNumber, episode } = e.state;
  if (tvId && seasonNumber && episode) {
    loadPlayer(tvId, "tv", "", { season: seasonNumber, episode });
  }
});

// ---- Home Page Genre Filter Row ----
function initHomeGenreFilter() {
  if (!document.getElementById("homeGenreChips")) return;

  let activeType = "movie";
  const chipsRow   = document.getElementById("homeGenreChips");
  const resultsRow = document.getElementById("homeGenreResults");

  async function loadChips(type) {
    chipsRow.innerHTML = "";
    const data = await apiCall("/genre/" + type + "/list");
    const genres = (data && data.genres) ? data.genres : [];

    genres.slice(0, 18).forEach(function(g, i) {
      const chip = document.createElement("button");
      chip.textContent = g.name;
      chip.dataset.id = g.id;
      chip.style.flexShrink = "0";
      chip.style.padding = "6px 14px";
      chip.style.borderRadius = "999px";
      chip.style.border = "1.5px solid rgba(255,255,255,0.13)";
      chip.style.background = "rgba(255,255,255,0.05)";
      chip.style.color = "rgba(255,255,255,0.75)";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "600";
      chip.style.cursor = "pointer";
      chip.style.whiteSpace = "nowrap";
      chip.style.transition = "all 0.15s";

      if (i === 0) activateChip(chip, g.id);

      chip.addEventListener("click", function() {
        chipsRow.querySelectorAll("button").forEach(function(c) {
          c.style.background = "rgba(255,255,255,0.05)";
          c.style.borderColor = "rgba(255,255,255,0.13)";
          c.style.color = "rgba(255,255,255,0.75)";
        });
        activateChip(chip, g.id);
      });
      chipsRow.appendChild(chip);
    });
  }

  function activateChip(chip, genreId) {
    chip.style.background  = "#ff2c2c";
    chip.style.borderColor = "#ff2c2c";
    chip.style.color       = "#fff";
    loadGenreResults(activeType, genreId);
  }

  async function loadGenreResults(type, genreId) {
    resultsRow.innerHTML = "<p class=\"placeholder\">Loading\u2026</p>";
    const data = await apiCall("/discover/" + type, { with_genres: genreId, sort_by: "popularity.desc", page: 1 });
    const items = ((data && data.results) ? data.results : []).filter(function(i) { return i.poster_path; }).slice(0, 14);
    resultsRow.innerHTML = "";
    if (!items.length) {
      resultsRow.innerHTML = "<p class=\"placeholder\">No results found.</p>";
      return;
    }
    items.forEach(function(item) {
      const card = createMovieCard(item, type);
      if (card) resultsRow.appendChild(card);
    });
  }

  document.querySelectorAll(".genre-home-type").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".genre-home-type").forEach(function(b) {
        b.style.background  = "rgba(255,255,255,0.05)";
        b.style.color       = "rgba(255,255,255,0.7)";
        b.style.borderColor = "rgba(255,255,255,0.12)";
        b.classList.remove("active");
      });
      btn.style.background  = "rgba(255,44,44,0.15)";
      btn.style.color       = "#ff2c2c";
      btn.style.borderColor = "rgba(255,44,44,0.4)";
      btn.classList.add("active");
      activeType = btn.dataset.type;
      loadChips(activeType);
    });
  });

  loadChips(activeType);
}

// ── Section 6 — Home Page Features ───────────────────────────────────────
async function loadNewEpisodes() {
  const container = document.getElementById("newEpisodes");
  if (!container) return;
  showSkeletons(container, 8);
  const data = await apiCall("/tv/airing_today");
  container.innerHTML = "";
  if (!data?.results) return;
  data.results
    .filter(i => i.poster_path)
    .slice(0, 20)
    .forEach((item, idx) => {
      const card = createMovieCard(item, "tv");
      if (card) container.appendChild(card);
    });
  addRowScrollArrows(container);
}

// Because You Watched — personalized row based on most recent watch
async function loadBecauseYouWatched() {
  const section   = document.getElementById("becauseYouWatchedSection");
  const container = document.getElementById("becauseYouWatched");
  const titleEl   = document.getElementById("becauseYouWatchedTitle");

  console.log("[BYW] section found:", !!section, "container found:", !!container);
  if (!section || !container) { console.log("[BYW] elements missing from DOM"); return; }

  const history = JSON.parse(localStorage.getItem("history") || "[]");
  console.log("[BYW] history entries:", history.length, history);
  if (!history.length) { console.log("[BYW] no history"); return; }

  // Deduplicate and sort by most recent
  const seen = new Set();
  const deduped = [];
  for (const h of [...history].sort((a,b) => (b.addedAt||0) - (a.addedAt||0))) {
    const id = h.tmdbId || h.id;
    if (!id || !h.type) continue;
    const key = h.type + "_" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(h);
    if (deduped.length >= 10) break;
  }

  // Pick most recent entry that has a valid id
  const recent = deduped.find(h => (h.tmdbId || h.id) && h.type);
  console.log("[BYW] most recent:", recent);
  if (!recent) return;

  const tmdbId = recent.tmdbId || recent.id;
  if (!tmdbId) return;

  // Fetch details to get genres
  const details = await apiCall("/" + recent.type + "/" + tmdbId);
  if (!details?.genres?.length) return;

  const genre      = details.genres[0];
  const recentTitle = details.title || details.name || "Your Recent Watch";

  // Fetch similar content by genre
  const endpoint = recent.type === "movie" ? "/discover/movie" : "/discover/tv";
  const data = await apiCall(endpoint, {
    with_genres: genre.id,
    sort_by: "popularity.desc",
    page: 1
  });

  if (!data?.results?.length) return;

  const filtered = data.results
    .filter(i => i.poster_path && String(i.id) !== String(tmdbId))
    .slice(0, 20);

  if (!filtered.length) return;

  titleEl.textContent = "Because You Watched " + recentTitle;
  section.style.removeProperty("display");
  section.style.display = "block";
  container.innerHTML = "";
  console.log("[BYW] rendering", filtered.length, "cards, section display:", section.style.display);

  let cardCount = 0;
  filtered.forEach((item) => {
    const card = createMovieCard(item, recent.type);
    if (card) {
      container.appendChild(card);
      cardCount++;
    }
  });
  console.log("[BYW] appended", cardCount, "cards");

  // Add scroll arrows after cards are in DOM
  if (!container.dataset.arrowsAdded) {
    addRowScrollArrows(container);
  }
}


// ---- Initial Load ----
function initHomePage() {
  loadHistory();
  loadWatchlist();
  fetchMovies("/movie/now_playing", "newMovies", "movie");
  fetchMovies("/movie/popular", "popularMovies", "movie");
  fetchMovies("/movie/top_rated", "topRatedMovies", "movie");
  fetchMovies("/tv/popular", "popularTV", "tv");
  fetchMovies("/tv/top_rated", "topRatedTV", "tv");
  renderContinueWatching();
  loadNewEpisodes();
  loadBecauseYouWatched();
  initHomeGenreFilter();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHomePage);
} else {
  initHomePage();
}

