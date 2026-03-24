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

// ── Splash screen — show on every page load ───────────────────────────────
(function() {
  const intro = document.getElementById("appIntro");
  if (!intro) return;

  const isHome = window.location.pathname === "/";

  // Add home class so CSS can show the progress bar on home only
  if (isHome) intro.classList.add("intro-home");

  // Remove hidden so it shows
  intro.classList.remove("hidden");

  // Home page = longer (2.6s) since there's more loading happening
  // Other pages = shorter (1.6s) just the wordmark
  const duration = isHome ? 2600 : 1600;

  setTimeout(() => {
    intro.classList.add("fade-out");
    setTimeout(() => {
      intro.style.display = "none";
    }, 800);
  }, duration);
})();

// ── Greeting on home page ─────────────────────────────────────────────────
function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5  && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

function showGreeting() {
  // Only on home page
  if (!document.getElementById("heroSection")) return;

  const name = localStorage.getItem("cr_user_name") || "";
  const greeting = getGreeting() + (name ? ", " + name : "");

  // Insert greeting below hero section
  const heroSection = document.getElementById("heroSection");
  if (!heroSection) return;

  // Don't add twice
  if (document.getElementById("homeGreeting")) return;

  const el = document.createElement("div");
  el.id = "homeGreeting";
  el.className = "home-greeting";
  el.textContent = greeting;
  heroSection.insertAdjacentElement("afterend", el);
}

// Call greeting after page loads
window.addEventListener("load", showGreeting);

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

// ── Section 9 — Performance ───────────────────────────────────────────────

// Request deduplication + short-term cache
// Prevents the same endpoint being fetched multiple times simultaneously
const _apiCache   = new Map(); // url → {data, ts}
const _apiPending = new Map(); // url → Promise
const API_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function apiCall(endpoint, params = {}) {
  try {
    showLoading(true);
    const queryString = new URLSearchParams(params).toString();
    const url = `${BACKEND_URL}/api/tmdb${endpoint}${queryString ? "?" + queryString : ""}`;

    console.log("API Call:", url);

    // Return cached result if fresh
    const cached = _apiCache.get(url);
    if (cached && Date.now() - cached.ts < API_CACHE_TTL) {
      showLoading(false);
      return cached.data;
    }

    // Deduplicate — if same URL is already in flight, wait for it
    if (_apiPending.has(url)) {
      showLoading(false);
      return _apiPending.get(url);
    }

    // New request
    const promise = fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        _apiCache.set(url, { data, ts: Date.now() });
        _apiPending.delete(url);
        return data;
      })
      .catch(err => {
        _apiPending.delete(url);
        throw err;
      });

    _apiPending.set(url, promise);
    const data = await promise;
    showLoading(false);
    return data;
  } catch (err) {
    console.error("API Error:", err);
    showLoading(false);
    return null;
  }
}


// ---- Watchlist Management ----
function toggleWatchlist(id, type, movie) {
  let index = watchlistData.findIndex(m => m.id === id && m.type === type);
  
  if (index > -1) {
    watchlistData.splice(index, 1);
    showToast("Removed from watchlist", "info");
  } else {
    watchlistData.push({ 
      id, 
      type, 
      title: movie.title || movie.name,
      poster_path: movie.poster_path,
      addedAt: new Date().toISOString()
    });
    showToast("Added to watchlist ✓", "success");
  }
  
  saveWatchlist();
  updateWatchlistBadge();
}

function isInWatchlist(id, type) {
  return watchlistData.some(m => m.id === id && m.type === type);
}

// Remove from watchlist directly from card
function removeFromWatchlist(id, type, btn) {
  const idx = watchlistData.findIndex(m => m.id === id && m.type === type);
  if (idx > -1) {
    watchlistData.splice(idx, 1);
    saveWatchlist();
    updateWatchlistBadge();
    showToast("Removed from Watchlist", "info");
    // Hide the remove button
    if (btn) btn.style.display = "none";
  }
}

// ── Person Filmography Panel ──────────────────────────────────────────────
let _personPanelOpen = false;

async function showPersonPanel(personId, personName) {
  // Create or reuse person panel
  let panel = document.getElementById("personPanel");
  let overlay = document.getElementById("personOverlay");

  if (!panel) {
    overlay = document.createElement("div");
    overlay.id = "personOverlay";
    overlay.className = "person-overlay";
    overlay.onclick = closePersonPanel;
    document.body.appendChild(overlay);

    panel = document.createElement("div");
    panel.id = "personPanel";
    panel.className = "person-panel";
    document.body.appendChild(panel);
  }

  // Show loading state
  overlay.classList.add("open");
  panel.classList.add("open");
  _personPanelOpen = true;

  panel.innerHTML = `
    <div class="person-panel-header">
      <button class="person-panel-close" onclick="closePersonPanel()">✕</button>
      <h3 class="person-panel-name">${personName}</h3>
    </div>
    <div class="person-panel-body">
      <div class="person-panel-loading">
        <div class="games-loading-spinner"></div>
        <p>Loading filmography…</p>
      </div>
    </div>
  `;

  try {
    const [details, credits] = await Promise.all([
      apiCall("/person/" + personId),
      apiCall("/person/" + personId + "/combined_credits")
    ]);

    const bio = details?.biography || "";
    const photo = details?.profile_path ? IMG_BASE + details.profile_path : "";
    const known = details?.known_for_department || "Acting";
    const bday  = details?.birthday ? new Date(details.birthday).getFullYear() : "";

    // Sort credits by popularity
    const allCredits = [
      ...(credits?.cast || []),
      ...(credits?.crew?.filter(c => ["Director","Creator","Writer"].includes(c.job)) || [])
    ]
      .filter(c => c.poster_path)
      .sort((a,b) => (b.popularity||0) - (a.popularity||0));

    // Deduplicate by id
    const seen = new Set();
    const unique = allCredits.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).slice(0, 40);

    panel.innerHTML = `
      <div class="person-panel-header">
        <button class="person-panel-close" onclick="closePersonPanel()">✕</button>
        <h3 class="person-panel-name">${personName}</h3>
      </div>
      <div class="person-panel-body">
        <div class="person-panel-info">
          ${photo ? `<img src="${photo}" class="person-panel-photo" alt="${personName}">` : ""}
          <div class="person-panel-meta">
            <div class="person-panel-known">${known}${bday ? ` · Born ${bday}` : ""}</div>
            ${bio ? `<p class="person-panel-bio">${bio.slice(0, 300)}${bio.length > 300 ? "…" : ""}</p>` : ""}
          </div>
        </div>

        <div class="person-panel-section-title">Known For (${unique.length})</div>
        <div class="person-filmography">
          ${unique.map(c => {
            const t = c.title || c.name || "";
            const mediaType = c.media_type || (c.title ? "movie" : "tv");
            const score = c.vote_average ? c.vote_average.toFixed(1) : null;
            return `
              <div class="person-film-card" onclick="closePersonPanel();setTimeout(()=>showMovieDetails({id:${c.id},poster_path:'${c.poster_path}',title:'${t.replace(/'/g,"\\'")}'},'${mediaType}'),200)">
                <div style="position:relative;">
                  <img src="${IMG_BASE + c.poster_path}" alt="${t}" loading="lazy">
                  ${score ? `<span class="card-score-badge ${parseFloat(score)>=7.5?'gold':parseFloat(score)>=6?'silver':'dim'}" style="font-size:9px;padding:2px 5px;">★${score}</span>` : ""}
                </div>
                <div class="person-film-title">${t}</div>
                ${c.character ? `<div class="person-film-char">${c.character}</div>` : ""}
                ${c.job ? `<div class="person-film-char">${c.job}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>

        ${ unique.length === 0 ? '<p style="color:rgba(255,255,255,0.3);padding:20px;">No credits found</p>' : "" }
      </div>
    `;
  } catch(e) {
    panel.querySelector(".person-panel-body").innerHTML = `<p style="color:rgba(255,255,255,0.4);padding:24px;">Failed to load filmography</p>`;
  }
}

function closePersonPanel() {
  const panel   = document.getElementById("personPanel");
  const overlay = document.getElementById("personOverlay");
  if (panel)   panel.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
  _personPanelOpen = false;
}

// Close person panel on Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && _personPanelOpen) closePersonPanel();
});

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

  const title    = movie.title || movie.name || "Unknown";
  const typeBadge = type === "tv" ? "TV" : (type === "anime" ? "Anime" : "Movie");
  const inWL     = isInWatchlist(movie.id, type);

  // Watched state
  const watchedKey = "cr_watched_" + type + "_" + movie.id;
  const isWatched  = localStorage.getItem(watchedKey) === "1";

  // Rating badge
  const score = movie.vote_average ? movie.vote_average.toFixed(1) : null;
  const scoreBadge = score && parseFloat(score) > 0 ? `
    <span class="card-score-badge ${parseFloat(score) >= 7.5 ? 'gold' : parseFloat(score) >= 6 ? 'silver' : 'dim'}">
      ★ ${score}
    </span>` : "";

  // HD badge — 70+ days since release = likely available in HD digitally
  // Also check user-confirmed HD votes from Firebase
  const releaseDate = movie.release_date || movie.first_air_date || "";
  const daysOld = releaseDate
    ? (Date.now() - new Date(releaseDate).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const autoHD = type === "movie" && daysOld >= 70;
  const userHD = _hdVotes[movie.id] >= 3; // 3+ community confirmations
  const hdBadge = (autoHD || userHD)
    ? `<span class="card-hd-badge" title="${userHD && !autoHD ? 'Community confirmed HD' : 'Available in HD'}">HD</span>` : "";

  // TV progress ring — % of total episodes watched
  let progressRing = "";
  if (type === "tv" && movie.number_of_episodes && movie.number_of_episodes > 0) {
    const watchedEps = historyData.filter(h =>
      h.type === "tv" && (h.tmdbId || h.id) == movie.id && h.episode
    ).length;
    const ringPercent = Math.min(100, Math.round((watchedEps / movie.number_of_episodes) * 100));
    if (ringPercent > 0) {
      const r = 14, circ = 2 * Math.PI * r;
      const dash = (ringPercent / 100) * circ;
      progressRing = `
        <svg class="card-progress-ring" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
          <circle cx="18" cy="18" r="${r}" fill="rgba(0,0,0,0.6)" stroke="rgba(255,255,255,0.15)" stroke-width="2.5"/>
          <circle cx="18" cy="18" r="${r}" fill="none" stroke="#ff2c2c" stroke-width="2.5"
            stroke-dasharray="${dash} ${circ}"
            stroke-dashoffset="${circ * 0.25}"
            stroke-linecap="round"/>
          <text x="18" y="21" text-anchor="middle" fill="#fff" font-size="8" font-weight="800">${ringPercent}%</text>
        </svg>`;
    }
  }

  // Hover info — runtime and year, shown mid-card not overlapping title
  const year = (movie.release_date || movie.first_air_date || "").split("-")[0];
  const runtime = movie.runtime ? Math.floor(movie.runtime/60) + "h " + (movie.runtime%60) + "m" : "";
  const hoverInfo = (year || runtime) ? `
    <div class="card-hover-info">
      ${year ? `<span>${year}</span>` : ""}
      ${runtime ? `<span>${runtime}</span>` : ""}
    </div>` : "";

  // Blur-up sources
  const thumbSrc = "https://image.tmdb.org/t/p/w92" + movie.poster_path;
  const fullSrc  = IMG_BASE + movie.poster_path;

  card.innerHTML = `
    <div class="card-image-wrapper">
      <img
        src="${thumbSrc}"
        data-src="${fullSrc}"
        alt="${title}"
        class="card-img-blur"
        loading="lazy">
      <span class="card-type-badge">${typeBadge}</span>
      ${scoreBadge}
      ${hdBadge}
      ${isWatched ? '<span class="card-watched-overlay">✓</span>' : ""}
      ${progressRing}
      ${inWL ? `<button class="card-remove-wl" title="Remove from Watchlist" onclick="event.stopPropagation();removeFromWatchlist(${movie.id},'${type}',this)">✕</button>` : ""}
      ${percent > 0 ? '<div class="progress-bar" style="width:' + percent + '%"></div>' : ""}
      ${hoverInfo}
      <div class="card-hover-shine"></div>
      <p>
        ${title}
        ${lastEpisodeLabel && type === "tv" ? '<br><span class="last-episode-tag">' + lastEpisodeLabel + '</span>' : ""}
      </p>
    </div>
  `;

  // Blur-up
  const img = card.querySelector("img");
  const fullImg = new Image();
  fullImg.onload = () => {
    img.src = fullSrc;
    img.classList.remove("card-img-blur");
    img.classList.add("card-img-loaded");
  };
  fullImg.src = fullSrc;

  // Preload on hover
  let hoverTimer = null;
  card.addEventListener("mouseenter", () => {
    hoverTimer = setTimeout(() => {
      apiCall("/" + type + "/" + movie.id);
    }, 300);
  });
  card.addEventListener("mouseleave", () => clearTimeout(hoverTimer));

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
        <div class="panel-cast-card" onclick="showPersonPanel(${c.id},'${c.name.replace(/'/g, "\\'")}')">
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

  // Director
  const director = credits?.crew?.find(c => c.job === "Director") ||
                   credits?.crew?.find(c => c.job === "Creator");
  const directorHTML = director ? `
    <div class="panel-director" onclick="showPersonPanel(${director.id},'${director.name.replace(/'/g,"\\'")}')">
      <span class="panel-director-label">${director.job}</span>
      <span class="panel-director-name">${director.name}</span>
      <span class="panel-director-arrow">→</span>
    </div>
  ` : "";

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
          ${directorHTML}
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
            <button class="panel-similar-btn" id="panelSimilarBtn" title="Find Similar">≈ Similar</button>
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

  // Find Similar — fetch recommendations and show in panel
  document.getElementById("panelSimilarBtn").onclick = async () => {
    const btn = document.getElementById("panelSimilarBtn");
    btn.textContent = "Loading…";
    btn.disabled = true;
    try {
      const recs = await apiCall("/" + type + "/" + movie.id + "/recommendations");
      const results = (recs?.results || []).filter(i => i.poster_path).slice(0, 20);
      if (!results.length) { showToast("No recommendations found", "info"); btn.textContent = "≈ Similar"; btn.disabled = false; return; }

      // Scroll to similar section or add one
      let simSection = panelBody.querySelector(".panel-similar-row");
      if (simSection) {
        simSection.scrollIntoView({ behavior: "smooth" });
      } else {
        const div = document.createElement("div");
        div.innerHTML = `
          <div class="panel-section-title">Recommended For You</div>
          <div class="panel-similar-row">
            ${results.map(s => `
              <div class="panel-similar-card" onclick="showMovieDetails({id:${s.id},poster_path:'${s.poster_path}',title:'${(s.title||s.name||"").replace(/'/g,"\\'")}'},'${type}')">
                <img src="${IMG_BASE + s.poster_path}" alt="${s.title||s.name}" loading="lazy">
                <div class="panel-similar-title">${s.title||s.name||""}</div>
              </div>
            `).join("")}
          </div>`;
        panelBody.querySelector(".panel-main").appendChild(div);
        div.scrollIntoView({ behavior: "smooth" });
      }
    } catch(e) {
      showToast("Failed to load recommendations", "error");
    }
    btn.textContent = "≈ Similar";
    btn.disabled = false;
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
    if (t === 'anime') base = 'https://vidzen.fun/tv/' + id + '/' + (media.season||1) + '/' + (media.episode||1);
    if (!base) return '';
    const params = {};
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? 'true' : 'false';
    if (t === 'anime' && opts.dub !== undefined) params.dub = opts.dub ? '1' : '0';
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

    // Always use the latest season/episode from _watchContext so switching
    // sources after changing episodes doesn't reset back to S1E1
    const ctx = window._watchContext;
    const currentMedia = ctx ? {
      ...media,
      season:  ctx.season  ?? media.season,
      episode: ctx.episode ?? media.episode,
      tmdbId:  ctx.tmdbId  ?? media.tmdbId,
      type:    ctx.type    ?? media.type,
    } : media;

    const currentOpts = ctx ? { ...opts, season: currentMedia.season, episode: currentMedia.episode } : opts;
    const url = buildProviderUrl(providerKey, currentMedia, currentOpts);
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
  // For anime — read dub preference from localStorage and use anime-priority sources
  const isAnime = media.type === "anime" || extraOpts.anime;
  const animeDub = localStorage.getItem("cr_anime_dub") === "dub";
  if (isAnime) {
    extraOpts.dub = animeDub;
    media.type = "anime";
  }

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

  // Render provider pills — Jupiter first for anime
  const animeDefault = (media.type === "anime") ? "Jupiter" : DEFAULT_SOURCE;
  const tabs = renderSourcePills(media, animeDefault, opts);
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

    // Skip if marked as watched
    const watchedKey = "cr_watched_" + item.type + "_" + id;
    if (localStorage.getItem(watchedKey) === "1") continue;

    // Include item if: has real progress, OR was recently visited (within 30 days)
    const hasProgress = item.progress > 30;
    const isFinished = item.progress && item.duration && item.progress >= item.duration - 60;
    const isRecent = (Date.now() - (item.addedAt || 0)) < 30 * 24 * 60 * 60 * 1000;

    if (isFinished) continue;
    if (!hasProgress && !isRecent) continue;

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

      // Add remove button to continue watching cards
      const imgWrapper = card.querySelector(".card-image-wrapper");
      if (imgWrapper) {
        const removeBtn = document.createElement("button");
        removeBtn.className = "card-cw-remove";
        removeBtn.title = "Remove from Continue Watching";
        removeBtn.innerHTML = "✕";
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          // Remove from history
          historyData = historyData.filter(h => {
            const hid = h.tmdbId || h.id;
            return !(hid == tmdbId && h.type === type);
          });
          saveHistory();
          card.style.transition = "opacity 0.3s, transform 0.3s";
          card.style.opacity = "0";
          card.style.transform = "scale(0.9)";
          setTimeout(() => { card.remove(); }, 300);
          showToast("Removed from Continue Watching", "info");
        };
        imgWrapper.appendChild(removeBtn);
      }

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



// ── Section 10 — Navigation UX ───────────────────────────────────────────

// Auto-hide header + transparent-to-solid on scroll
(function() {
  const hdr = document.querySelector("header");
  if (!hdr) return;

  let lastY    = 0;
  let ticking  = false;

  function onScroll() {
    const y = window.scrollY;

    // Transparent → solid
    if (y > 40) hdr.classList.add("scrolled");
    else hdr.classList.remove("scrolled");

    // Auto-hide: hide when scrolling down past 120px, show when scrolling up
    if (y > 120) {
      if (y > lastY + 4) {
        hdr.classList.add("header-hidden");
      } else if (y < lastY - 4) {
        hdr.classList.remove("header-hidden");
      }
    } else {
      hdr.classList.remove("header-hidden");
    }

    lastY = y;
    ticking = false;
  }

  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(onScroll);
      ticking = true;
    }
  }, { passive: true });

  onScroll();
})();

// Scroll-to-top button
(function() {
  const btn = document.createElement("button");
  btn.id = "scrollTopBtn";
  btn.className = "scroll-top-btn";
  btn.innerHTML = "↑";
  btn.title = "Back to top";
  btn.setAttribute("aria-label", "Scroll to top");
  document.body.appendChild(btn);

  window.addEventListener("scroll", () => {
    if (window.scrollY > 400) btn.classList.add("visible");
    else btn.classList.remove("visible");
  }, { passive: true });

  btn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
})();

// ── Section 13 — Extra Premium Polish ────────────────────────────────────

// ── 1. Favicon animation ──────────────────────────────────────────────────
let _faviconInterval = null;

function startFaviconAnimation() {
  const link = document.querySelector("link[rel*='icon']") || (() => {
    const l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); return l;
  })();
  const canvas = document.createElement("canvas");
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext("2d");
  let frame = 0;
  if (_faviconInterval) clearInterval(_faviconInterval);
  _faviconInterval = setInterval(() => {
    ctx.clearRect(0, 0, 32, 32);
    const alpha = 0.7 + Math.sin(frame * 0.15) * 0.3;
    ctx.fillStyle = `rgba(255,44,44,${alpha})`;
    ctx.beginPath(); ctx.arc(16, 16, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(12,9); ctx.lineTo(12,23); ctx.lineTo(24,16); ctx.closePath(); ctx.fill();
    link.href = canvas.toDataURL("image/png");
    frame++;
  }, 1000);
}

function stopFaviconAnimation() {
  if (_faviconInterval) { clearInterval(_faviconInterval); _faviconInterval = null; }
  const link = document.querySelector("link[rel*='icon']");
  if (link) link.href = "/favicon.ico";
}

if (window.location.pathname.startsWith("/watch")) {
  window.addEventListener("load", () => setTimeout(startFaviconAnimation, 2000));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) startFaviconAnimation();
    else stopFaviconAnimation();
  });
}

// ── 3. Custom context menu ────────────────────────────────────────────────
(function() {
  const menu = document.createElement("div");
  menu.id = "crContextMenu";
  menu.className = "cr-context-menu";
  menu.style.display = "none";
  document.body.appendChild(menu);

  let ctxCard = null;

  document.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".movie-card");
    if (!card) { menu.style.display = "none"; return; }
    e.preventDefault();
    ctxCard = card;

    const titleEl = card.querySelector("p");
    const title = titleEl ? titleEl.textContent.trim().split("\n")[0].trim() : "Unknown";
    const type = card.dataset.type || "movie";

    menu.innerHTML = `
      <div class="cr-ctx-header">${title}</div>
      <button class="cr-ctx-item" data-action="details">ⓘ More Info</button>
      <button class="cr-ctx-item" data-action="share">⬆ Copy Link</button>
    `;

    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    menu.style.left = x + window.scrollX + "px";
    menu.style.top  = y + window.scrollY + "px";
    menu.style.display = "block";
  });

  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    menu.style.display = "none";
    const action = btn.dataset.action;
    if (action === "details" && ctxCard) ctxCard.click();
    if (action === "share") {
      navigator.clipboard.writeText(window.location.href)
        .then(() => showToast("Link copied!", "success")).catch(() => {});
    }
  });

  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) menu.style.display = "none"; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.style.display = "none"; });
})();

// Dynamic page titles
(function() {
  const path = window.location.pathname;
  const titles = {
    "/":          "CineRealm — Stream Movies, TV & Anime",
    "/movies":    "Movies — CineRealm",
    "/trending":  "Trending — CineRealm",
    "/watchlist": "My Watchlist — CineRealm",
    "/search":    "Search — CineRealm",
    "/genres":    "Browse Genres — CineRealm",
    "/stats":     "My Stats — CineRealm",
    "/games":     "Games — CineRealm",
    "/legal":     "Legal — CineRealm",
  };

  const q = new URLSearchParams(window.location.search).get("q");
  if (path === "/search" && q) {
    document.title = `"${q}" — CineRealm`;
  } else if (titles[path]) {
    document.title = titles[path];
  }
})();

// Recently viewed — track what cards are clicked and show as chips
const RECENTLY_VIEWED_KEY = "cr_recently_viewed";

function addRecentlyViewed(movie, type) {
  try {
    const id = movie.id;
    const title = movie.title || movie.name || "";
    if (!id || !title) return;

    let recent = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || "[]");
    // Remove existing entry for same item
    recent = recent.filter(r => !(r.id === id && r.type === type));
    // Add to front
    recent.unshift({ id, type, title, poster_path: movie.poster_path || "" });
    // Keep max 8
    recent = recent.slice(0, 8);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(recent));
    renderRecentlyViewed();
  } catch(e) {}
}

function renderRecentlyViewed() {
  const container = document.getElementById("recentlyViewedBar");
  if (!container) return;

  const recent = JSON.parse(localStorage.getItem(RECENTLY_VIEWED_KEY) || "[]");
  if (!recent.length) { container.style.display = "none"; return; }

  container.style.display = "flex";
  container.innerHTML = `
    <span class="rv-label">Recently viewed:</span>
    ${recent.map(r => `
      <button class="rv-chip" data-id="${r.id}" data-type="${r.type}"
        data-title="${r.title.replace(/"/g,'&quot;')}"
        data-poster="${r.poster_path}">
        ${r.title}
      </button>
    `).join("")}
    <button class="rv-clear" onclick="localStorage.removeItem('${RECENTLY_VIEWED_KEY}');renderRecentlyViewed();">✕ Clear</button>
  `;

  container.querySelectorAll(".rv-chip").forEach(chip => {
    chip.onclick = () => {
      const movie = {
        id: parseInt(chip.dataset.id),
        title: chip.dataset.title,
        name: chip.dataset.title,
        poster_path: chip.dataset.poster
      };
      showMovieDetails(movie, chip.dataset.type);
    };
  });
}

// Patch showMovieDetails to track recently viewed
const _origShowMovieDetails = showMovieDetails;
window.showMovieDetails = async function(movie, type) {
  addRecentlyViewed(movie, type);
  return _origShowMovieDetails(movie, type);
};
// Also patch the global reference
// (handled by the window assignment above)

// ── Section 12 — Push Notifications ──────────────────────────────────────
const FCM_VAPID_KEY = "BOsL8MnlTNg3rBdAVKccsOKUYyZrNg_V6ZKDqOQYZTGWGWzr5D7NeymF4BHWy44RUVD3nt79hnGim_Wgrp-HANs";

async function initPushNotifications() {
  if (!("Notification" in window)) return;
  if (!("serviceWorker" in navigator)) return;
  if (Notification.permission === "denied") return;
  if (Notification.permission === "granted") { await registerFCMToken(); return; }
  if (sessionStorage.getItem("cr_notif_prompted")) return;
  sessionStorage.setItem("cr_notif_prompted", "1");
  setTimeout(showNotifPrompt, 8000);
}

function showNotifPrompt() {
  if (window.location.pathname.startsWith("/watch")) return;
  if (sessionStorage.getItem("cr_notif_dismissed")) return;
  const banner = document.createElement("div");
  banner.id = "notifPromptBanner";
  banner.className = "notif-prompt-banner";
  banner.innerHTML = `
    <div class="notif-prompt-icon">🔔</div>
    <div class="notif-prompt-text">
      <strong>Stay updated</strong>
      <span>Get notified about new episodes and watch party invites</span>
    </div>
    <div class="notif-prompt-btns">
      <button class="notif-allow-btn" id="notifAllowBtn">Allow</button>
      <button class="notif-dismiss-btn" id="notifDismissBtn">Not now</button>
    </div>
  `;
  document.body.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add("visible"));
  document.getElementById("notifAllowBtn").onclick = async () => {
    banner.remove();
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      await registerFCMToken();
      showToast("Notifications enabled ✓", "success");
    }
  };
  document.getElementById("notifDismissBtn").onclick = () => {
    banner.remove();
    sessionStorage.setItem("cr_notif_dismissed", "1");
  };
}

async function registerFCMToken() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getMessaging, getToken, onMessage } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js");
    const firebaseConfig = {
      apiKey: "AIzaSyAIRrBzdN6Rvndo5G4w6ILTa9xoJ_95VrM",
      authDomain: "cinerealm-8b7b9.firebaseapp.com",
      databaseURL: "https://cinerealm-8b7b9-default-rtdb.firebaseio.com",
      projectId: "cinerealm-8b7b9",
      storageBucket: "cinerealm-8b7b9.firebasestorage.app",
      messagingSenderId: "1076768481536",
      appId: "1:1076768481536:web:4fd3bdc3f222e4850ad3e5"
    };
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    const fcmMessaging = getMessaging(app);
    const token = await getToken(fcmMessaging, { vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) {
      localStorage.setItem("cr_fcm_token", token);
      console.log("FCM token registered");
    }
    onMessage(fcmMessaging, payload => {
      const { title, body } = payload.notification || {};
      if (title) showToast("🔔 " + title + (body ? " — " + body : ""), "info");
    });
  } catch(err) {
    console.warn("FCM registration failed:", err);
  }
}

function sendLocalNotification(title, body, url = "/") {
  if (Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then(reg => {
    reg.showNotification(title, {
      body, icon: "/android-chrome-512x512.png",
      badge: "/favicon-32x32.png",
      data: { url }, tag: "cinerealm-local"
    });
  });
}

if (!window.location.pathname.startsWith("/watch")) {
  window.addEventListener("load", () => setTimeout(initPushNotifications, 3000));
}

// ── Global Tab Cloak System ───────────────────────────────────────────────
(function() {
  // Presets loaded from /cloak-config.js — edit that file to add/remove presets
  function getPresets() {
    return window.CR_CLOAK_PRESETS || [
      { id: "gdocs",     name: "Google Docs",   title: "Document",          icon: "https://ssl.gstatic.com/docs/doclist/images/mediatype/icon_1_document_x32.png" },
      { id: "classroom", name: "Classroom",     title: "Google Classroom",  icon: "https://www.gstatic.com/images/branding/product/1x/classroom_2020q4_32dp.png" },
      { id: "khan",      name: "Khan Academy",  title: "Khan Academy",      icon: "https://cdn.kastatic.org/images/favicon.ico" },
      { id: "canvas",    name: "Canvas",        title: "Dashboard",         icon: "https://du11hjcvx0uqb.cloudfront.net/dist/images/favicon-e10d657a73.ico" },
    ];
  }

  // Keys that are unreliable on Chromebook
  const RISKY_KEYS = ["Escape","Tab","Enter"," ","Control","Alt","Meta","Shift","CapsLock","Backspace"];
  const RISKY_PREFIXES = ["Alt","Ctrl","Meta"];

  let _activePresetId = localStorage.getItem("cr_cloak_preset") || null;
  let _panicKey       = localStorage.getItem("cr_panic_key")    || "F3";
  let _panicUrl       = localStorage.getItem("cr_panic_url")    || "https://classroom.google.com";
  let _customPresets  = JSON.parse(localStorage.getItem("cr_cloak_custom") || "[]");
  let _panel          = null;
  let _btn            = null;
  let _listening      = false; // for key capture mode

  // ── Favicon fix — removes ALL existing favicons and force-replaces ─────
  function setFavicon(url) {
    document.querySelectorAll("link[rel*='icon']").forEach(el => el.remove());
    ["shortcut icon", "icon"].forEach(rel => {
      const l = document.createElement("link");
      l.rel   = rel;
      l.type  = "image/x-icon";
      l.href  = url + (url.includes("?") ? "&" : "?") + "_cr=" + Date.now();
      document.head.appendChild(l);
    });
  }

  function getDefaultTitle() {
    const p = window.location.pathname;
    return ({
      "/":          "CineRealm — Stream Movies, TV & Anime",
      "/movies":    "Movies — CineRealm",
      "/trending":  "Trending — CineRealm",
      "/watchlist": "My Watchlist — CineRealm",
      "/search":    "Search — CineRealm",
      "/genres":    "Genres — CineRealm",
      "/anime":     "Anime — CineRealm",
      "/games":     "Games — CineRealm",
      "/stats":     "Stats — CineRealm",
      "/legal":     "Legal — CineRealm",
    })[p] || "CineRealm";
  }

  function applyCloak(title, iconUrl, presetId) {
    document.title = title || document.title;
    setFavicon(iconUrl || "/favicon.ico");
    _activePresetId = presetId || null;
    localStorage.setItem("cr_cloak_title",  title    || "");
    localStorage.setItem("cr_cloak_icon",   iconUrl  || "");
    localStorage.setItem("cr_cloak_preset", presetId || "");
    updateUI();
    if (typeof showToast === "function") showToast("Tab cloaked", "success");
  }

  function removeCloak() {
    document.title = getDefaultTitle();
    setFavicon("/favicon.ico");
    _activePresetId = null;
    localStorage.removeItem("cr_cloak_title");
    localStorage.removeItem("cr_cloak_icon");
    localStorage.removeItem("cr_cloak_preset");
    updateUI();
    if (typeof showToast === "function") showToast("Cloak removed", "info");
  }

  // Restore on load
  const _savedTitle = localStorage.getItem("cr_cloak_title");
  const _savedIcon  = localStorage.getItem("cr_cloak_icon");
  if (_savedTitle || _savedIcon) {
    setTimeout(() => {
      if (_savedTitle) document.title = _savedTitle;
      if (_savedIcon)  setFavicon(_savedIcon);
    }, 150);
  }

  // ── Panic key ─────────────────────────────────────────────────────────
  document.addEventListener("keydown", e => {
    if (_listening) return; // don't fire panic while capturing key
    if (["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (e.key === _panicKey) {
      e.preventDefault();
      window.location.href = _panicUrl;
    }
  });

  // ── UI helpers ────────────────────────────────────────────────────────
  function updateUI() {
    if (!_panel) return;
    const badge    = _panel.querySelector("#crCloakBadge");
    const badgeName = _panel.querySelector("#crCloakBadgeName");
    const btn      = document.getElementById("crCloakBtn");
    const allPresets = _panel.querySelectorAll(".cr-cloak-preset");

    if (_activePresetId || _savedTitle) {
      const p = getPresets().find(x => x.id === _activePresetId)
             || _customPresets.find(x => x.id === _activePresetId);
      badge.classList.add("visible");
      badgeName.textContent = p ? p.name : (document.title || "Custom");
      if (btn) btn.classList.add("active");
    } else {
      badge.classList.remove("visible");
      if (btn) btn.classList.remove("active");
    }

    allPresets.forEach(el => {
      el.classList.toggle("selected", el.dataset.id === _activePresetId);
    });

    renderCustomPresets();
  }

  function renderCustomPresets() {
    if (!_panel) return;
    const section = _panel.querySelector("#crCustomPresetsSection");
    const list    = _panel.querySelector("#crCustomPresetsList");
    if (!list) return;
    _customPresets = JSON.parse(localStorage.getItem("cr_cloak_custom") || "[]");
    if (!_customPresets.length) { section.style.display = "none"; return; }
    section.style.display = "block";
    list.innerHTML = _customPresets.map((p, i) => `
      <div class="cr-custom-preset-item">
        <img src="${p.icon}" style="width:14px;height:14px;object-fit:contain;" onerror="this.style.display='none'">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</span>
        <button onclick="window._cloakApplyCustom(${i})" style="background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:11px;font-weight:700;">Use</button>
        <button onclick="window._cloakDeleteCustom(${i})" style="background:none;border:none;color:rgba(255,100,100,0.5);cursor:pointer;font-size:13px;">✕</button>
      </div>
    `).join("");
  }

  window._cloakApplyCustom = function(i) {
    const p = _customPresets[i];
    if (p) applyCloak(p.title, p.icon, p.id);
  };
  window._cloakDeleteCustom = function(i) {
    _customPresets.splice(i, 1);
    localStorage.setItem("cr_cloak_custom", JSON.stringify(_customPresets));
    renderCustomPresets();
  };
  window.removeCloak = removeCloak;

  // ── Build panel ───────────────────────────────────────────────────────
  function buildPanel() {
    const el = document.createElement("div");
    el.className = "cr-cloak-panel";
    el.id = "crCloakPanel";
    el.innerHTML = `
      <div class="cr-cloak-panel-header">
        <h4>🎭 Tab Cloak</h4>
        <button class="cr-cloak-panel-close" id="crCloakClose">✕</button>
      </div>

      <div class="cr-cloak-section">
        <div class="cr-cloak-active-badge" id="crCloakBadge">
          <span>🟢 Cloaked as:</span>
          <strong id="crCloakBadgeName"></strong>
          <button onclick="removeCloak()" style="background:none;border:none;color:rgba(255,100,100,0.7);cursor:pointer;font-size:11px;margin-left:auto;padding:0 4px;">✕ Remove</button>
        </div>
        <div class="cr-cloak-section-label">Quick Presets</div>
        <div class="cr-cloak-presets" id="crCloakPresets"></div>
      </div>

      <div class="cr-cloak-section">
        <div class="cr-cloak-section-label">Custom Cloak</div>
        <div class="cr-cloak-input-group">
          <div class="cr-cloak-input-label">Tab Title</div>
          <input class="cr-cloak-input" id="crCloakTitleInput" placeholder="e.g. Document - Google Docs" autocomplete="off">
        </div>
        <div class="cr-cloak-input-group">
          <div class="cr-cloak-input-label">Favicon URL</div>
          <input class="cr-cloak-input" id="crCloakIconInput" placeholder="https://site.com/favicon.ico" autocomplete="off">
        </div>
        <div class="cr-cloak-btn-row">
          <button class="cr-cloak-action-btn primary" id="crCloakApply">Apply</button>
          <button class="cr-cloak-action-btn secondary" id="crCloakRemove">Remove</button>
          <button class="cr-cloak-action-btn secondary" id="crCloakSave">+ Save Preset</button>
        </div>
        <div class="cr-cloak-btn-row" style="margin-top:6px;">
          <button class="cr-cloak-action-btn secondary" id="crCloakAboutBlank" style="flex:1;">Open in about:blank ↗</button>
        </div>
      </div>

      <div class="cr-cloak-section" id="crCustomPresetsSection" style="display:none;">
        <div class="cr-cloak-section-label">Your Saved Presets</div>
        <div id="crCustomPresetsList"></div>
      </div>

      <div class="cr-cloak-section">
        <div class="cr-cloak-section-label">Panic Key</div>
        <p style="font-size:11px;color:rgba(255,255,255,0.35);margin:0 0 10px;line-height:1.5;">
          Press <span class="cr-panic-key-display" id="crPanicKeyDisplay">${_panicKey}</span> anywhere on CineRealm to instantly redirect away.
        </p>
        <div class="cr-cloak-input-group">
          <div class="cr-cloak-input-label">Key <span style="color:rgba(255,44,44,0.6);font-size:10px;margin-left:4px;" id="crPanicKeyWarn"></span></div>
          <input class="cr-cloak-input" id="crPanicKeyInput" placeholder="Click then press a key..." value="${_panicKey}" readonly autocomplete="off">
        </div>
        <div class="cr-cloak-input-group">
          <div class="cr-cloak-input-label">Redirect URL</div>
          <input class="cr-cloak-input" id="crPanicUrlInput" placeholder="https://classroom.google.com" value="${_panicUrl}" autocomplete="off">
        </div>
        <div class="cr-cloak-btn-row">
          <button class="cr-cloak-action-btn primary" id="crPanicSave">Save</button>
          <button class="cr-cloak-action-btn secondary" id="crPanicTest">Test →</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function buildBtn() {
    const el = document.createElement("button");
    el.className = "cr-cloak-btn";
    el.id = "crCloakBtn";
    el.innerHTML = `<span>🎭</span><span>Cloak</span>`;
    document.body.appendChild(el);
    return el;
  }

  // ── Init ──────────────────────────────────────────────────────────────
  window.addEventListener("load", () => {
    _panel = buildPanel();
    _btn   = buildBtn();

    // Toggle panel
    _btn.onclick = () => {
      _panel.classList.toggle("open");
      if (_panel.classList.contains("open")) updateUI();
    };
    _panel.querySelector("#crCloakClose").onclick = () => _panel.classList.remove("open");

    // Close on outside click
    document.addEventListener("click", e => {
      if (_panel.classList.contains("open") &&
          !_panel.contains(e.target) &&
          e.target !== _btn) {
        _panel.classList.remove("open");
      }
    });

    // Build preset buttons
    const presetsEl = _panel.querySelector("#crCloakPresets");
    getPresets().forEach(p => {
      const btn = document.createElement("button");
      btn.className = "cr-cloak-preset" + (_activePresetId === p.id ? " selected" : "");
      btn.dataset.id = p.id;
      btn.innerHTML = `<img src="${p.icon}" onerror="this.style.display='none'">${p.name}`;
      btn.onclick = () => applyCloak(p.title, p.icon, p.id);
      presetsEl.appendChild(btn);
    });

    // Apply custom cloak
    _panel.querySelector("#crCloakApply").onclick = () => {
      const t = _panel.querySelector("#crCloakTitleInput").value.trim();
      const i = _panel.querySelector("#crCloakIconInput").value.trim();
      if (!t && !i) { showToast("Enter a title or icon URL", "error"); return; }
      applyCloak(t || document.title, i || "/favicon.ico", null);
    };

    // Remove cloak
    _panel.querySelector("#crCloakRemove").onclick = removeCloak;

    // Save custom preset
    _panel.querySelector("#crCloakSave").onclick = () => {
      const t = _panel.querySelector("#crCloakTitleInput").value.trim();
      const i = _panel.querySelector("#crCloakIconInput").value.trim();
      if (!t) { showToast("Enter a title to save", "error"); return; }
      const newPreset = { id: "custom_" + Date.now(), name: t.slice(0,20), title: t, icon: i || "/favicon.ico" };
      _customPresets.push(newPreset);
      localStorage.setItem("cr_cloak_custom", JSON.stringify(_customPresets));
      renderCustomPresets();
      showToast("Preset saved", "success");
    };

    // About blank
    _panel.querySelector("#crCloakAboutBlank").onclick = () => {
      const w = window.open("about:blank", "_blank");
      if (!w) { showToast("Allow popups to use about:blank", "error"); return; }
      fetch(window.location.href)
        .then(r => r.text())
        .then(html => { w.document.open(); w.document.write(html); w.document.close(); });
    };

    // ── Panic key capture — click field then press key ────────────────
    const panicKeyInput = _panel.querySelector("#crPanicKeyInput");
    const panicWarn     = _panel.querySelector("#crPanicKeyWarn");

    panicKeyInput.addEventListener("focus", () => {
      _listening = true;
      panicKeyInput.value = "Press a key...";
      panicKeyInput.style.borderColor = "rgba(255,44,44,0.6)";
    });

    panicKeyInput.addEventListener("keydown", e => {
      if (!_listening) return;
      e.preventDefault();
      const key = e.key;

      // Warn about risky keys on Chromebook
      const isRisky = RISKY_KEYS.includes(key) || RISKY_PREFIXES.some(p => key.startsWith(p));
      if (isRisky) {
        panicWarn.textContent = "⚠ May not work on Chromebook";
      } else {
        panicWarn.textContent = "";
      }

      panicKeyInput.value = key;
      panicKeyInput.style.borderColor = "";
      _listening = false;
    });

    panicKeyInput.addEventListener("blur", () => {
      if (_listening) {
        panicKeyInput.value = _panicKey;
        _listening = false;
        panicKeyInput.style.borderColor = "";
      }
    });

    // Save panic settings
    _panel.querySelector("#crPanicSave").onclick = () => {
      const key = panicKeyInput.value.trim();
      const url = _panel.querySelector("#crPanicUrlInput").value.trim();
      if (!key || key === "Press a key...") { showToast("Press a key first", "error"); return; }
      _panicKey = key;
      _panicUrl = url || "https://classroom.google.com";
      localStorage.setItem("cr_panic_key", _panicKey);
      localStorage.setItem("cr_panic_url", _panicUrl);
      _panel.querySelector("#crPanicKeyDisplay").textContent = _panicKey;
      showToast("Panic key saved: " + _panicKey, "success");
    };

    // Test panic
    _panel.querySelector("#crPanicTest").onclick = () => {
      window.location.href = _panel.querySelector("#crPanicUrlInput").value || _panicUrl;
    };

    updateUI();
  });
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

// ── Watchlist count badge ─────────────────────────────────────────────────
function updateWatchlistBadge() {
  const watchlist = JSON.parse(localStorage.getItem("watchlist") || "[]");
  const count = watchlist.length;
  let badge = document.getElementById("watchlistBadge");

  // Find the watchlist nav link
  const watchlistLink = document.querySelector('a[href="/watchlist"].nav-btn');
  if (!watchlistLink) return;

  if (!badge) {
    badge = document.createElement("span");
    badge.id = "watchlistBadge";
    badge.className = "watchlist-badge";
    watchlistLink.style.position = "relative";
    watchlistLink.appendChild(badge);
  }

  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : count;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

// Call on load and after any watchlist change
updateWatchlistBadge();

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

// ── Mobile bottom nav bar ─────────────────────────────────────────────────
(function() {
  const currentPath = window.location.pathname;

  const navItems = [
    { href: "/",          icon: "🏠", label: "Home"      },
    { href: "/search",    icon: "🔍", label: "Search"    },
    { href: "/trending",  icon: "🔥", label: "Trending"  },
    { href: "/watchlist", icon: "★",  label: "Watchlist" },
    { href: "/stats",     icon: "📊", label: "Stats"     },
  ];

  const bar = document.createElement("nav");
  bar.className = "mobile-bottom-nav";
  bar.id = "mobileBottomNav";

  bar.innerHTML = navItems.map(item => {
    const isActive = currentPath === item.href ||
      (item.href !== "/" && currentPath.startsWith(item.href));
    return `
      <a href="${item.href}" class="mobile-nav-item ${isActive ? "active" : ""}">
        <span class="mobile-nav-icon">${item.icon}</span>
        <span class="mobile-nav-label">${item.label}</span>
      </a>
    `;
  }).join("");

  document.body.appendChild(bar);
})();

// ── Swipe gestures on watch page ──────────────────────────────────────────
(function() {
  if (!window.location.pathname.startsWith("/watch")) return;

  let touchStartX = 0;
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 80;
  const ANGLE_THRESHOLD = 30; // degrees — must be mostly horizontal

  document.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const angle = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);

    // Only handle horizontal swipes (not scrolling)
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (angle > ANGLE_THRESHOLD && angle < (180 - ANGLE_THRESHOLD)) return;

    const ctx = window._watchContext;
    if (!ctx || ctx.type !== "tv") return;

    if (dx < 0) {
      // Swipe left → next episode
      showToast("Next Episode →", "info");
      setTimeout(() => {
        window.location.href = "/watch/tv/" + ctx.tmdbId +
          "/season/" + ctx.season + "/episode/" + (ctx.episode + 1);
      }, 400);
    } else {
      // Swipe right → previous episode
      if (ctx.episode <= 1) return;
      showToast("← Previous Episode", "info");
      setTimeout(() => {
        window.location.href = "/watch/tv/" + ctx.tmdbId +
          "/season/" + ctx.season + "/episode/" + (ctx.episode - 1);
      }, 400);
    }
  }, { passive: true });
})();
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
  renderRecentlyViewed();
  fetchMovies("/movie/now_playing", "newMovies", "movie");
  fetchMovies("/movie/popular", "popularMovies", "movie");
  fetchMovies("/movie/top_rated", "topRatedMovies", "movie");
  fetchMovies("/tv/popular", "popularTV", "tv");
  fetchMovies("/tv/top_rated", "topRatedTV", "tv");
  renderContinueWatching();
  loadNewEpisodes();
  loadBecauseYouWatched();
  initHomeGenreFilter();
  loadUpNext();
  loadTopPicks();
  loadGenrePersonalRows();
  loadTrendingTicker();
}

// ── Section 17 — HD Vote System ──────────────────────────────────────────
let _hdVotes = {}; // cache: movieId -> vote count
let _myHdVotes = JSON.parse(localStorage.getItem("cr_hd_votes") || "{}"); // movies I've voted on

// Load HD votes from Firebase on startup
(async function loadHDVotes() {
  try {
    const { getDatabase, ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp({
      apiKey: "AIzaSyAIRrBzdN6Rvndo5G4w6ILTa9xoJ_95VrM",
      authDomain: "cinerealm-8b7b9.firebaseapp.com",
      databaseURL: "https://cinerealm-8b7b9-default-rtdb.firebaseio.com",
      projectId: "cinerealm-8b7b9",
    });
    const db = getDatabase(app);
    const snap = await get(ref(db, "hd_votes"));
    if (snap.exists()) _hdVotes = snap.val();
  } catch(e) {}
})();

async function voteHD(movieId, movieTitle) {
  if (_myHdVotes[movieId]) {
    showToast("You already confirmed this as HD", "info");
    return;
  }

  try {
    const { getDatabase, ref, runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    const { initializeApp, getApps } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const app = getApps().length ? getApps()[0] : initializeApp({
      apiKey: "AIzaSyAIRrBzdN6Rvndo5G4w6ILTa9xoJ_95VrM",
      authDomain: "cinerealm-8b7b9.firebaseapp.com",
      databaseURL: "https://cinerealm-8b7b9-default-rtdb.firebaseio.com",
      projectId: "cinerealm-8b7b9",
    });
    const db = getDatabase(app);

    await runTransaction(ref(db, "hd_votes/" + movieId), current => (current || 0) + 1);

    _myHdVotes[movieId] = true;
    localStorage.setItem("cr_hd_votes", JSON.stringify(_myHdVotes));
    _hdVotes[movieId] = (_hdVotes[movieId] || 0) + 1;

    const count = _hdVotes[movieId];
    if (count >= 3) {
      showToast("HD confirmed! Badge added.", "success");
    } else {
      showToast(`HD vote recorded (${count}/3 needed)`, "info");
    }
  } catch(e) {
    showToast("Failed to record vote", "error");
  }
}

// ── Section 18 — Watch Page Upgrades ─────────────────────────────────────

// ── Up Next row — next episodes for in-progress TV shows ─────────────────
async function loadUpNext() {
  const section = document.getElementById("upNextSection");
  const row     = document.getElementById("upNextRow");
  if (!section || !row) return;

  const tvShows = historyData.filter(h =>
    h.type === "tv" && h.season && h.episode &&
    (Date.now() - (h.addedAt || 0)) < 60 * 24 * 60 * 60 * 1000 // within 60 days
  ).sort((a,b) => (b.addedAt||0) - (a.addedAt||0));

  // Deduplicate by show
  const seen = new Set();
  const unique = tvShows.filter(h => {
    const id = h.tmdbId || h.id;
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).slice(0, 15);

  if (!unique.length) return;

  // Build next episode entries
  const nextEps = [];
  for (const h of unique) {
    const id = h.tmdbId || h.id;
    try {
      const data = await apiCall("/tv/" + id);
      if (!data) continue;

      // Figure out next episode
      let nextSeason  = h.season;
      let nextEpisode = h.episode + 1;

      const seasonData = data.seasons?.find(s => s.season_number === h.season);
      if (seasonData && h.episode >= seasonData.episode_count) {
        // End of season — go to next
        nextSeason  = h.season + 1;
        nextEpisode = 1;
        if (nextSeason > (data.number_of_seasons || 1)) continue; // finished show
      }

      nextEps.push({ data, id, nextSeason, nextEpisode });
    } catch(e) {}
  }

  if (!nextEps.length) return;
  section.style.display = "block";
  row.innerHTML = "";

  for (const { data, id, nextSeason, nextEpisode } of nextEps) {
    if (!data.poster_path) continue;
    const card = createMovieCard(data, "tv");
    if (!card) continue;

    // Add next ep badge
    const label = card.querySelector("p");
    if (label) {
      label.innerHTML += `<br><span class="last-episode-tag" style="color:#ff6b6b;">▶ S${nextSeason} E${nextEpisode}</span>`;
    }

    // Override click to go directly to next episode
    card.onclick = (e) => {
      e.preventDefault();
      window.location.href = `/watch/tv/${id}/season/${nextSeason}/episode/${nextEpisode}`;
    };

    row.appendChild(card);
  }
  addRowScrollArrows(row);
}

// ── Top Picks For You — based on genre taste profile ─────────────────────
async function loadTopPicks() {
  const section = document.getElementById("topPicksSection");
  const row     = document.getElementById("topPicksRow");
  if (!section || !row) return;
  if (historyData.length < 3) return; // need some history first

  // Get top genre from watch history
  const genreCounts = {};
  for (const h of historyData.slice(0, 30)) {
    const id = h.tmdbId || h.id;
    try {
      const data = await apiCall("/" + h.type + "/" + id);
      (data?.genres || []).forEach(g => {
        genreCounts[g.id] = (genreCounts[g.id] || 0) + 1;
      });
    } catch(e) {}
  }

  const topGenreId = Object.entries(genreCounts).sort((a,b) => b[1]-a[1])[0]?.[0];
  if (!topGenreId) return;

  const data = await apiCall("/discover/movie", {
    with_genres: topGenreId,
    sort_by: "vote_average.desc",
    "vote_count.gte": "500",
    page: Math.floor(Math.random() * 3) + 1
  });

  const results = (data?.results || []).filter(m => m.poster_path).slice(0, 20);
  if (!results.length) return;

  section.style.display = "block";
  showSkeletons("topPicksRow", 10);
  row.innerHTML = "";
  results.forEach(m => {
    const card = createMovieCard(m, "movie");
    if (card) row.appendChild(card);
  });
  addRowScrollArrows(row);
}

// ── Because You Like [Genre] rows ─────────────────────────────────────────
async function loadGenrePersonalRows() {
  const container = document.getElementById("genrePersonalRows");
  if (!container) return;
  if (historyData.length < 5) return;

  // Get top 3 genres from watch history
  const genreMap = {};
  const recentHistory = historyData.slice(0, 40);

  await Promise.all(recentHistory.map(async h => {
    try {
      const id = h.tmdbId || h.id;
      const data = await apiCall("/" + h.type + "/" + id);
      (data?.genres || []).forEach(g => {
        if (!genreMap[g.id]) genreMap[g.id] = { name: g.name, count: 0 };
        genreMap[g.id].count++;
      });
    } catch(e) {}
  }));

  const top3 = Object.entries(genreMap)
    .sort((a,b) => b[1].count - a[1].count)
    .slice(0, 3);

  if (!top3.length) return;

  for (const [genreId, genreInfo] of top3) {
    const data = await apiCall("/discover/movie", {
      with_genres: genreId,
      sort_by: "popularity.desc",
      page: 1
    });

    const results = (data?.results || []).filter(m => m.poster_path).slice(0, 20);
    if (!results.length) continue;

    const section = document.createElement("section");
    const rowId = "genreRow_" + genreId;
    section.innerHTML = `
      <h2>
        <span class="section-title-text">Because You Like ${genreInfo.name}</span>
        <a href="/genres?genre=${genreId}" class="see-all">See All →</a>
      </h2>
      <div id="${rowId}" class="movie-row"></div>
    `;
    container.appendChild(section);

    const row = section.querySelector("#" + rowId);
    results.forEach(m => {
      const card = createMovieCard(m, "movie");
      if (card) row.appendChild(card);
    });
    addRowScrollArrows(row);
  }
}

// ── Trending ticker ───────────────────────────────────────────────────────
async function loadTrendingTicker() {
  const ticker = document.getElementById("trendingTicker");
  const track  = document.getElementById("trendingTickerTrack");
  if (!ticker || !track) return;

  try {
    const data = await apiCall("/trending/all/day");
    const items = (data?.results || []).slice(0, 20);
    if (!items.length) { ticker.style.display = "none"; return; }

    // Build ticker content — duplicate for seamless loop
    const html = items.map(item => {
      const title = item.title || item.name || "";
      const type  = item.media_type === "tv" ? "TV" : "Movie";
      return `<span class="ticker-item" onclick="showMovieDetails({id:${item.id},poster_path:'${item.poster_path||""}',title:'${title.replace(/'/g,"\\'")}'},'${item.media_type||"movie"}')">
        <span class="ticker-type">${type}</span> ${title}
      </span>`;
    }).join('<span class="ticker-sep">·</span>');

    // Duplicate for seamless loop
    track.innerHTML = html + html;
    ticker.style.display = "flex";
  } catch(e) {
    ticker.style.display = "none";
  }
}

// ── Hero meta badges (rating, seasons, year) ──────────────────────────────
const _origShowHeroSlide = window.showHeroSlide || function(){};
function showHeroSlide(index) {
  if (!heroItems.length) return;
  const movie = heroItems[index];
  const heroBg = document.getElementById("heroBg");
  const heroTitle = document.getElementById("heroTitle");
  const heroOverview = document.getElementById("heroOverview");
  const heroMeta = document.getElementById("heroMetaBadges");
  const dotsContainer = document.getElementById("heroDots");

  if (!heroBg || !heroTitle || !heroOverview) return;

  heroBg.style.backgroundImage = `url(${IMG_BASE.replace("/w500", "/w1280")}${movie.backdrop_path})`;
  heroTitle.textContent = movie.title || movie.name || "Trending now";
  heroOverview.textContent = movie.overview || "";

  // Meta badges
  if (heroMeta) {
    const year = (movie.release_date || movie.first_air_date || "").split("-")[0];
    const rating = movie.vote_average ? movie.vote_average.toFixed(1) : null;
    const isTV = !!(movie.name || movie.first_air_date);
    const mediaType = isTV ? "TV Show" : "Movie";

    heroMeta.innerHTML = `
      <span class="hero-badge">${mediaType}</span>
      ${year ? `<span class="hero-badge">${year}</span>` : ""}
      ${rating ? `<span class="hero-badge hero-badge-rating">⭐ ${rating}</span>` : ""}
    `;
  }

  if (dotsContainer) {
    dotsContainer.querySelectorAll(".hero-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  const playBtn = document.getElementById("heroPlayBtn");
  const moreBtn = document.getElementById("heroMoreBtn");

  if (playBtn) {
    const isTV = !!(movie.name || movie.first_air_date);
    playBtn.onclick = () => {
      window.location.href = isTV
        ? `/watch/tv/${movie.id}/season/1/episode/1`
        : `/watch/movie/${movie.id}`;
    };
  }
  if (moreBtn) {
    moreBtn.onclick = () => {
      const type = (movie.name || movie.first_air_date) ? "tv" : "movie";
      showMovieDetails(movie, type);
    };
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initHomePage);
} else {
  initHomePage();
}

