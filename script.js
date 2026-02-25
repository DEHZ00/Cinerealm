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
  historyData = JSON.parse(localStorage.getItem("history") || "[]");
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

function showError(message) {
  const errorDiv = document.createElement("div");
  errorDiv.className = "error-message";
  errorDiv.textContent = message;
  document.body.appendChild(errorDiv);
  setTimeout(() => errorDiv.remove(), 4000);
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
  let inWatchlist = isInWatchlist(movie.id, type);
let lastEpisodeLabel = "";
if (type === "tv" && historyData && historyData.length) {
  const lastEntry = historyData
    .filter(e => e.type === "tv" && e.tmdbId === movie.id)
    .sort((a, b) => b.addedAt - a.addedAt)[0];

  if (lastEntry && lastEntry.season && lastEntry.episode) {
    lastEpisodeLabel = `S${lastEntry.season} · E${lastEntry.episode}`;
  }
}

  const title = movie.title || movie.name || "Unknown";
  
 card.innerHTML = `
  <div class="card-image-wrapper">
    <img src="${IMG_BASE + movie.poster_path}" alt="${title}" loading="lazy">
    ${percent > 0 ? `<div class="progress-bar" style="width:${percent}%"></div>` : ""}
    <div class="card-overlay">
      <button class="play-btn">▶ Play</button>
      <div class="card-buttons">
        <button class="watchlist-btn" title="Add to watchlist">${inWatchlist ? "★" : "☆"}</button>
        <button class="info-btn" title="More info">ⓘ</button>
      </div>
    </div>
  </div>
  <p>
    ${title}
    ${lastEpisodeLabel && type === "tv" ? `<br><span class="last-episode-tag">${lastEpisodeLabel}</span>` : ""}
  </p>
`;


card.querySelector(".play-btn").onclick = (e) => {
  e.stopPropagation();

  // Determine if an Anime based on TMDB
  const isAnimation = movie.genre_ids?.includes(16);
  const isJapanese = movie.origin_country?.includes("JP");
  const isAnime = type === "tv" && isAnimation && isJapanese;
  
  const effectiveType = isAnime ? "anime" : type;

  if (effectiveType === "tv" || effectiveType === "anime") {
    const tvEntries = (historyData || [])
      .filter(h => h.tmdbId === movie.id && h.season && h.episode)
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

    let season = 1;
    let episode = 1;

    if (tvEntries.length) {
      season = tvEntries[0].season;
      episode = tvEntries[0].episode;
    }

    // Redirect with type=anime if detected
    window.location.href = `/watch/${effectiveType}/${movie.id}/season/${season}/episode/${episode}`;
  } else {
    window.location.href = `/watch/movie/${movie.id}`;
  }
};



  card.querySelector(".watchlist-btn").onclick = (e) => {
    e.stopPropagation();
    toggleWatchlist(movie.id, type, movie);
    const btn = e.target;
    btn.textContent = isInWatchlist(movie.id, type) ? "★" : "☆";
  };

  card.querySelector(".info-btn").onclick = (e) => {
    e.stopPropagation();
    showMovieDetails(movie, type);
  };

  return card;
}

async function getAnimeIdsFromTmdb(tmdbId) {
  try {
  
  
    const res = await fetch(`${BACKEND_URL}/api/tmdb/tv/${tmdbId}/external_ids`);
    const external = await res.json();
    
  
    const mappingRes = await fetch(`https://api.consumet.org/meta/anilist/info/${tmdbId}?provider=tmdb`);
    const data = await mappingRes.json();
    
    return {
      anilistId: data.id,
      malId: data.malId
    };
  } catch (e) {
    console.error("Mapping error:", e);
    return null;
  }
}
// ---- Show Movie Details in Modal ----
async function showMovieDetails(movie, type) {
  const data = await apiCall(`/${type}/${movie.id}`);
  if (!data) return;

  const genres = data.genres?.map(g => g.name).join(", ") || "N/A";
  const rating = data.vote_average?.toFixed(1) || "N/A";
  const overview = data.overview || "No description available";
  const releaseDate = data.release_date || data.first_air_date || "N/A";
  const runtime = data.runtime ? `${data.runtime} min` : (data.episode_run_time?.[0] + " min" || "N/A");

  detailsBody.innerHTML = `
    <div class="details-card">
      <img src="${IMG_BASE + movie.poster_path}" alt="${movie.title || movie.name}" class="details-poster">
      <div class="details-info">
        <h2>${movie.title || movie.name}</h2>
        <div class="details-meta">
          <span class="rating">⭐ ${rating}/10</span>
          <span class="release">${releaseDate}</span>
          <span class="runtime">${runtime}</span>
        </div>
        <p class="genres"><strong>Genres:</strong> ${genres}</p>
        <p class="overview">${overview}</p>
      </div>
    </div>
  `;
  
  detailsModal.style.display = "block";
}

// Close modal
closeBtn.onclick = () => {
  detailsModal.style.display = "none";
};

window.onclick = (e) => {
  if (e.target === detailsModal) {
    detailsModal.style.display = "none";
  }
};

// ----------------- MULTI-SOURCE PLAYER -----------------


let DEFAULT_SOURCE = "FluxLine";

// Provider
const PROVIDERS = [
  { name: "NovaReel",  key: "spenEmbed", supports: { movie: true, tv: true, anime: true }  },
  { name: "FluxLine",  key: "vidplus",   supports: { movie: true, tv: true, anime: true }  }, 
  { name: "PulseView", key: "vidfast",   supports: { movie: true, tv: true, anime: false } },
  { name: "King",      key: "vidking",   supports: { movie: true, tv: true, anime: false } },
  { name: "Ez",        key: "videasy",   supports: { movie: true, tv: true, anime: true }  }, // Updated
  { name: "Seenima",   key: "vidora",    supports: { movie: true, tv: true, anime: false } },
  { name: "Saturn",    key: "VidSrc",    supports: { movie: true, tv: true, anime: true }  }, // Updated
  { name: "Mars" ,     key: "vidlink",   supports: { movie: true, tv: true, anime: true }  }  // Updated
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
  const id = media.tmdbId || media.id || (media.anilistId && t === "anime" ? media.anilistId : "");
  if (!id) return "";
  


  if (providerKey === "spenEmbed") {
    // spencerdevs.xyz: supports theme
    let base = "";
    if (t === "movie") base = `https://spencerdevs.xyz/movie/${id}`;
    if (t === "tv") base = `https://spencerdevs.xyz/tv/${id}/${media.season || 1}/${media.episode || 1}`;
    if (t === "anime") base = `https://spencerdevs.xyz/anime/${media.anilistId || id}/${media.episode || 1}`;
    const params = {};
    if (opts.theme || opts.color) params.theme = (opts.theme || opts.color).replace("#", "");
    return base + buildQuery(params);
  }

  if (providerKey === "vidplus") {
  // player.vidplus.to 
    let base = "";
    if (t === "movie") base = `https://player.vidplus.to/embed/movie/${id}`;
    if (t === "tv") base = `https://player.vidplus.to/embed/tv/${id}/${media.season || 1}/${media.episode || 1}`;
    if (t === "anime") base = `https://player.vidplus.to/embed/anime/${media.anilistId || id}/${media.episode || 1}`;
    const params = {};
    if (opts.color) params.primarycolor = opts.color.replace("#", "");
    if (opts.secondaryColor) params.secondarycolor = opts.secondaryColor.replace("#", "");
    if (opts.iconColor) params.iconcolor = opts.iconColor.replace("#", "");
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? "true" : "false";
    if (opts.autoNext !== undefined) params.autoNext = opts.autoNext ? "true" : "false";
    if (opts.nextButton !== undefined) params.nextButton = opts.nextButton ? "true" : "false";
    if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
    if (opts.watchparty !== undefined) params.watchparty = opts.watchparty ? "true" : "false";
    if (opts.chromecast !== undefined) params.chromecast = opts.chromecast ? "true" : "false";
    if (opts.episodelist !== undefined) params.episodelist = opts.episodelist ? "true" : "false";
    if (opts.server !== undefined) params.server = opts.server;
    if (opts.poster !== undefined) params.poster = opts.poster ? "true" : "false";
    if (opts.title !== undefined) params.title = opts.title ? "true" : "false";
    if (opts.icons !== undefined) params.icons = opts.icons;
    if (opts.fontcolor) params.fontcolor = opts.fontcolor.replace("#", "");
    if (opts.fontsize) params.fontsize = opts.fontsize;
    if (opts.opacity !== undefined) params.opacity = opts.opacity;
    if (opts.servericon !== undefined) params.servericon = opts.servericon ? "true" : "false";
    return base + buildQuery(params);
  }
  if (providerKey === "vidfast") {
    // vidfast.pro 
    const baseDomain = "https://vidfast.pro";
    let base = "";
    if (t === "movie") base = `${baseDomain}/movie/${id}`;
    if (t === "tv") base = `${baseDomain}/tv/${id}/${media.season || 1}/${media.episode || 1}`;
    const params = {};
    if (opts.autoPlay !== undefined) params.autoPlay = opts.autoPlay ? "true" : "false";
    if (opts.startAt !== undefined) params.startAt = Math.floor(opts.startAt);
    if (opts.theme) params.theme = opts.theme.replace("#", "");
    if (opts.nextButton !== undefined) params.nextButton = opts.nextButton ? "true" : "false";
    if (opts.autoNext !== undefined) params.autoNext = opts.autoNext ? "true" : "false";
    if (opts.server) params.server = opts.server;
    if (opts.hideServerControls !== undefined) params.hideServerControls = opts.hideServerControls ? "true" : "false";
    if (opts.fullscreenButton !== undefined) params.fullscreenButton = opts.fullscreenButton ? "true" : "false";
    if (opts.chromecast !== undefined) params.chromecast = opts.chromecast ? "true" : "false";
    if (opts.sub) params.sub = opts.sub;
    if (opts.title !== undefined) params.title = opts.title ? "true" : "false";
    if (opts.poster !== undefined) params.poster = opts.poster ? "true" : "false";
    return base + buildQuery(params);
  }

  if (providerKey === "vidking") {
    // vidking.net embed path
    if (t === "movie") {
      const base = `https://www.vidking.net/embed/movie/${id}`;
      const params = {};
      if (opts.color) params.color = opts.color.replace("#", "");
      if (opts.autoPlay !== undefined) params.autoPlay = opts.autoPlay ? "true" : "false";
      if (opts.nextEpisode !== undefined) params.nextEpisode = opts.nextEpisode ? "true" : "false";
      if (opts.episodeSelector !== undefined) params.episodeSelector = opts.episodeSelector ? "true" : "false";
      if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
      return base + buildQuery(params);
    }
    if (t === "tv") {
      const base = `https://www.vidking.net/embed/tv/${id}/${media.season || 1}/${media.episode || 1}`;
      const params = {};
      if (opts.color) params.color = opts.color.replace("#", "");
      if (opts.autoPlay !== undefined) params.autoPlay = opts.autoPlay ? "true" : "false";
      if (opts.nextEpisode !== undefined) params.nextEpisode = opts.nextEpisode ? "true" : "false";
      if (opts.episodeSelector !== undefined) params.episodeSelector = opts.episodeSelector ? "true" : "false";
      if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
      return base + buildQuery(params);
    }
  }

  if (providerKey === "videasy") {
    // player.videasy.net endpoints
    if (t === "movie") {
      const base = `https://player.videasy.net/movie/${id}`;
      const params = {};
      if (opts.color) params.color = opts.color.replace("#", "");
      if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
      if (opts.overlay !== undefined) params.overlay = opts.overlay ? "true" : "false";
      // TV extras
      if (opts.nextEpisode !== undefined) params.nextEpisode = opts.nextEpisode ? "true" : "false";
      if (opts.episodeSelector !== undefined) params.episodeSelector = opts.episodeSelector ? "true" : "false";
      if (opts.autoplayNextEpisode !== undefined) params.autoplayNextEpisode = opts.autoplayNextEpisode ? "true" : "false";
      if (opts.dub !== undefined) params.dub = opts.dub ? "true" : "false";
      return base + buildQuery(params);
    }
    
    if (t === "tv") {
      const base = `https://player.videasy.net/tv/${id}/${media.season || 1}/${media.episode || 1}`;
      const params = {};
      if (opts.color) params.color = opts.color.replace("#", "");
      if (opts.progress !== undefined) params.progress = Math.floor(opts.progress);
      if (opts.nextEpisode !== undefined) params.nextEpisode = opts.nextEpisode ? "true" : "false";
      if (opts.episodeSelector !== undefined) params.episodeSelector = opts.episodeSelector ? "true" : "false";
      if (opts.autoplayNextEpisode !== undefined) params.autoplayNextEpisode = opts.autoplayNextEpisode ? "true" : "false";
      if (opts.overlay !== undefined) params.overlay = opts.overlay ? "true" : "false";
      if (opts.dub !== undefined) params.dub = opts.dub ? "true" : "false";
      return base + buildQuery(params);
    }
    if (t === "anime") {
      // Shows need episode
      const isMovie = !media.episode; 
      const base = isMovie 
        ? `https://player.videasy.net/anime/${media.anilistId || id}`
        : `https://player.videasy.net/anime/${media.anilistId || id}/${media.episode || 1}`;
        
      const params = {};
      if (opts.dub !== undefined) params.dub = opts.dub ? "true" : "false"; //
      if (opts.color) params.color = opts.color.replace("#", "");
      return base + buildQuery(params);
    }
  }
  if (providerKey === "vidora") {
    // vidora.su routes:
    // Movie: https://vidora.su/movie/{tmdbId or imdbId}
    // TV:    https://vidora.su/tv/{tmdbId or imdbId}/{season}/{episode}

    let base = "";
    if (t === "movie") base = `https://vidora.su/movie/${id}`;
    if (t === "tv") base = `https://vidora.su/tv/${id}/${media.season || 1}/${media.episode || 1}`;

    const params = {};
    // Vidora params from docs
    if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? "true" : "false";
    if (opts.colour || opts.color) params.colour = (opts.colour || opts.color).replace("#", "");
    if (opts.autonextepisode !== undefined) params.autonextepisode = opts.autonextepisode ? "true" : "false";
    if (opts.backbutton) params.backbutton = opts.backbutton;
    if (opts.logo) params.logo = opts.logo;
    if (opts.pausescreen !== undefined) params.pausescreen = opts.pausescreen ? "true" : "false";
    if (opts.idlecheck !== undefined) params.idlecheck = opts.idlecheck;

    return base + buildQuery(params);
  }


   if (providerKey === "vidlink") {
   

    let base = "";
    if (t === "movie") base = `https://vidlink.pro/movie/${id}`;
    if (t === "tv") base = `https://vidlink.pro/tv/${id}/${media.season || 1}/${media.episode || 1}`;
if (t === "anime") {
      const subOrDub = opts.dub ? "dub" : "sub"; //
     
      const malId = media.malId || media.anilistId || id; 
      
      base = `https://vidlink.pro/anime/${malId}/${media.episode || 1}/${subOrDub}`;
      const params = { fallback: "true" }; // Forces fallback if dub/sub isn't found
      
      if (opts.color) params.primaryColor = opts.color.replace("#", ""); //
      if (opts.autoplay !== undefined) params.autoplay = opts.autoplay ? "true" : "false";
      if (opts.nextButton !== undefined) params.nextbutton = opts.nextButton ? "true" : "false";
      if (opts.startAt !== undefined && opts.startAt > 0) params.startAt = Math.floor(opts.startAt); //
      
      return base + buildQuery(params);
    }
  }

  // NEW PROVIDER, VIDSRC
if (providerKey === "VidSrc") {
    let base = "";
    const params = {};

    if (t === "movie") {
      base = `https://vidsrc.cc/v3/embed/movie/${id}`;
    } else if (t === "tv") {
      base = `https://vidsrc.cc/v3/embed/tv/${id}/${media.season || 1}/${media.episode || 1}`;
    } else if (t === "anime") {
      const subOrDub = opts.dub ? "dub" : "sub";
      let idString = "";
      
      // VidSrc v2 for Anime requires specific prefixes
      if (media.anilistId) idString = `ani${media.anilistId}`;
      else if (media.tmdbId) idString = `tmdb${media.tmdbId}`;
      else idString = id;

      base = `https://vidsrc.cc/v2/embed/anime/${idString}/${media.episode || 1}/${subOrDub}`;
      if (opts.autoSkipIntro !== undefined) params.autoSkipIntro = opts.autoSkipIntro ? "true" : "false";
    }

    if (opts.autoplay !== undefined) params.autoPlay = opts.autoplay ? "true" : "false";
    
    if (Number.isFinite(opts.startAt) && opts.startAt > 0) {
      params.startAt = Math.floor(opts.startAt);
    }

    return base + buildQuery(params);
  }

  
  return ""; 
}



 


// Iframe lifecycle
let currentIframe = null;
function unloadIframe() {
  if (!currentIframe) return;
  try { currentIframe.src = "about:blank"; } catch(e){/*ignore*/ }
  if (currentIframe.parentNode) currentIframe.parentNode.removeChild(currentIframe);
  currentIframe = null;
}
function insertIframe(url) {
  unloadIframe();
  if (!url) {
    showError("No playable URL for this source.");
    return null;
  }
  const iframe = document.createElement("iframe");
  iframe.id = "active-player-iframe";
  iframe.src = url;
  iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen");
  iframe.setAttribute("allowfullscreen", "");
  iframe.style.width = "100%";
  iframe.style.height = "600px";
  iframe.style.border = "none";
  iframe.loading = "lazy";
  // attach a basic error handler
  iframe.addEventListener("error", () => {
    const err = document.getElementById("player-error");
    if (err) err.style.display = "block";
  });
  const placeholder = document.getElementById("player-iframe-placeholder") || playerDiv;
  placeholder.appendChild(iframe);
  currentIframe = iframe;
  return iframe;
}

// Render source tabs (pills)
function renderSourcePills(media, defaultName, opts) {
  const bar = document.createElement("div");
  bar.className = "source-tabs-bar";
  const scroll = document.createElement("div");
  scroll.className = "source-tabs-scroll";
  bar.appendChild(scroll);

  //  last provider from localStorage (if valid for this media type)
  const savedProvider = localStorage.getItem("cine_last_provider");
  const initialName =
    savedProvider && PROVIDERS.some(p => p.name === savedProvider && p.supports[media.type])
      ? savedProvider
      : defaultName;

  PROVIDERS.forEach(p => {
    if (!p.supports[media.type]) return; // skip incompatible providers
    const btn = document.createElement("button");
    btn.className = "source-tab";
    btn.type = "button";
    btn.dataset.key = p.key;
    btn.textContent = p.name;

    if (p.name === initialName) btn.classList.add("active");

    btn.addEventListener("click", () => {
      // highlight
      scroll.querySelectorAll(".source-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // remember choice
      localStorage.setItem("cine_last_provider", p.name);

      // hide previous error
      const err = document.getElementById("player-error");
      if (err) err.style.display = "none";

      // Build provider-specific URL and load
      const url = buildProviderUrl(p.key, media, opts);
      insertIframe(url);
    });

    scroll.appendChild(btn);
  });

  return bar;
}

// ---- ID Mapping Helper ----
async function getMalIdFromAnilist(anilistId) {
  if (!anilistId) return null;
  try {
    const query = `
      query ($id: Int) {
        Media (id: $id, type: ANIME) {
          idMal
        }
      }
    `;
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json' 
      },
      body: JSON.stringify({ query, variables: { id: parseInt(anilistId) } })
    });
    
    const data = await response.json();
    return data?.data?.Media?.idMal || null;
  } catch (e) {
    console.error("Failed to fetch MAL ID:", e);
    return null;
  }
}
// Unified loadPlayer  call from cards
async function loadPlayer(id, type = "movie", title = "", extraOpts = {}) {
  let anilistId = extraOpts.anilistId;
  // anime, fetch the MAL ID for VidLink compatibility
  let malId = extraOpts.malId;
 if (type === "anime" && !anilistId) {
    showLoading(true);
    const ids = await getAnimeIdsFromTmdb(id);
    if (ids) {
      anilistId = ids.anilistId;
      malId = ids.malId;
    }
    showLoading(false);
  }

  // anilist but no MAL (needed for VidLink/Mars)
  if (type === "anime" && anilistId && !malId) {
    malId = await getMalIdFromAnilist(anilistId);
  }
  const media = {
    type,
    tmdbId: id,
    season: extraOpts.season,
    episode: extraOpts.episode,
    anilistId: anilistId,
    malId: malId // Passed down to buildProviderUrl
  };

  const lastProgress = getHistoryProgress(id, type, extraOpts.season, extraOpts.episode);

  const animeControls = type === "anime" ? `
    <div class="anime-options" style="margin-bottom: 10px; display: flex; gap: 10px; align-items: center;">
      <label style="color: white; cursor: pointer;">
        <input type="checkbox" id="dubToggle" ${extraOpts.dub ? "checked" : ""}>
        Watch Dubbed
      </label>
      <label style="color: white; cursor: pointer;">
        <input type="checkbox" id="skipIntroToggle" ${extraOpts.autoSkipIntro ? "checked" : ""}>
        Auto Skip Intro
      </label>
    </div>
  ` : "";
  
  // render player wrapper
  playerDiv.innerHTML = `
    <div class="player-wrapper">
      <div class="player-header">
        <h3>${title || ""}</h3>
        <span class="player-type">${type === "tv" ? "TV Show" : (type === "anime" ? "Anime" : "Movie")}</span>
      </div>
      ${animeControls}
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
    poster: extraOpts.poster ?? true,
    title: extraOpts.title ?? true,
    icons: extraOpts.icons ?? "true",
    servericon: extraOpts.servericon ?? true,
    chromecast: extraOpts.chromecast ?? true,
    hideServerControls: extraOpts.hideServerControls ?? false,
    fullscreenButton: extraOpts.fullscreenButton ?? true,
    startAt: extraOpts.startAt ?? 0,
    server: extraOpts.server ?? undefined,
    fontcolor: extraOpts.fontcolor ?? undefined,
    fontsize: extraOpts.fontsize ?? undefined,
    opacity: extraOpts.opacity ?? undefined,
    dub: extraOpts.dub ?? false, // Default to sub
    autoSkipIntro: extraOpts.autoSkipIntro ?? false,
    progress: lastProgress ?? 0
  };

  // Render provider pills
  const tabs = renderSourcePills(media, DEFAULT_SOURCE, opts);
  document.getElementById("player-tabs-placeholder").appendChild(tabs);

  const activeBtn = tabs.querySelector(".source-tab.active") || tabs.querySelector(".source-tab");
  if (activeBtn) activeBtn.click();

  currentlyPlaying = { id, type, title, media, opts };
  setTimeout(() => playerDiv.scrollIntoView({ behavior: "smooth" }), 80);

  // FIX: Properly scoped Event Listeners for Anime Toggles
  if (type === "anime") {
    const dubToggle = document.getElementById("dubToggle");
    const skipToggle = document.getElementById("skipIntroToggle");

    if (dubToggle) {
      dubToggle.addEventListener("change", (e) => {
        opts.dub = e.target.checked;
        const currentActive = tabs.querySelector(".source-tab.active");
        if (currentActive) currentActive.click(); // Reload active source
      });
    }
    
    if (skipToggle) {
      skipToggle.addEventListener("change", (e) => {
        opts.autoSkipIntro = e.target.checked;
        const currentActive = tabs.querySelector(".source-tab.active");
        if (currentActive) currentActive.click(); 
      });
    }
  }
}
// ---- Fetch Movies or TV ----
async function fetchMovies(endpoint, containerId, type = "movie") {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = "";
  const data = await apiCall(endpoint);
  
  if (!data || !data.results) {
    container.innerHTML = `<p class="placeholder">No content found</p>`;
    return;
  }

  data.results
    .filter(item => item.poster_path)
    .forEach(item => {
      const card = createMovieCard(item, type);
      if (card) container.appendChild(card);
    });
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

  // --- Load Episodes for a Season ---
  async function loadEpisodes(seasonNumber) {
    const seasonData = await apiCall(`/tv/${tvId}/season/${seasonNumber}`);
    episodeList.innerHTML = "";
    if (!seasonData || !seasonData.episodes) return;

    seasonData.episodes.forEach(ep => {
      const epDiv = document.createElement("div");
      epDiv.className = "episode-card";

      const epProgress = getHistoryProgress(tvId, "tv", seasonNumber, ep.episode_number);
      const resumeBadge = epProgress > 0
        ? `<span class="resume-badge">Resume at ${formatTime(epProgress)}</span>`
        : "";

      epDiv.innerHTML = `
        <img src="${ep.still_path ? IMG_BASE + ep.still_path : ""}" alt="${ep.name}" class="episode-poster">
        <div class="episode-info">
          <strong>${ep.episode_number}. ${ep.name}</strong>
          ${resumeBadge}
          <p>${ep.overview || ""}</p>
        </div>
      `;

      epDiv.addEventListener("click", () => {
        const lastProgress = getHistoryProgress(tvId, "tv", seasonNumber, ep.episode_number);

        loadPlayer(tvId, "tv", media.title || media.name || "", {
          ...extraOpts,
          season: seasonNumber,
          episode: ep.episode_number,
          progress: lastProgress
        });
      });

      episodeList.appendChild(epDiv);
    });
  }

  // Season dropdown change → load episodes for selected season
  seasonSelect.addEventListener("change", (e) => {
    const chosen = parseInt(e.target.value, 10);
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
    if (!item || !item.type || !item.tmdbId) continue;

    if (!item.progress || !item.duration || item.duration < 60) continue;
    if (item.progress >= item.duration - 60) continue; // basically finished

    const key = `${item.type}-${item.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    compact.push(item);

    if (compact.length >= 20) break;
  }

  if (compact.length === 0) {
    container.innerHTML = `<p class="placeholder">No movies or shows to continue. Start watching to see them here!</p>`;
    return;
  }

  for (const entry of compact) {
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

const sb = document.getElementById("searchBar");
if (sb) {
  sb.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const q = sb.value.trim();
    if (!q) return showError("Please enter a search term");
    window.location.href = `/search?q=${encodeURIComponent(q)}`;
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
  const heroBg = document.getElementById("heroBg");
  const heroTitle = document.getElementById("heroTitle");
  const heroOverview = document.getElementById("heroOverview");
  const dotsContainer = document.getElementById("heroDots");

  if (!heroBg || !heroTitle || !heroOverview) return;

  heroBg.style.backgroundImage = `url(${IMG_BASE.replace("/w500", "/w780")}${movie.backdrop_path})`;
  heroTitle.textContent = movie.title || movie.name || "Trending title";
  heroOverview.textContent = movie.overview || "";

  // update dots
  if (dotsContainer) {
    dotsContainer.querySelectorAll(".hero-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  // hook up buttons
  const playBtn = document.getElementById("heroPlayBtn");
  const moreBtn = document.getElementById("heroMoreBtn");

  if (playBtn) {
    playBtn.onclick = () => {
      window.location.href = `/watch/movie/${movie.id}`;
    };
  }

  if (moreBtn) {
    moreBtn.onclick = () => {
      showMovieDetails(movie, "movie");
    };
  }
}

function nextHeroSlide() {
  if (!heroItems.length) return;
  heroIndex = (heroIndex + 1) % heroItems.length;
  showHeroSlide(heroIndex);
}

async function initHeroCarousel() {
  const heroSection = document.getElementById("heroSection");
  if (!heroSection) return; // not on this page

  const data = await apiCall("/trending/movie/week");
  if (!data || !data.results || !data.results.length) {
    heroSection.style.display = "none";
    return;
  }

  heroItems = data.results.filter(m => m.backdrop_path).slice(0, 5);
  if (!heroItems.length) {
    heroSection.style.display = "none";
    return;
  }

  heroIndex = 0;
  buildHeroDots();
  showHeroSlide(0);

  if (heroTimer) clearInterval(heroTimer);
  heroTimer = setInterval(nextHeroSlide, 12000); // ~12s per slide
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

    // Find correct history entry
    let entry = historyData.find((m) => {
      if (m.type !== mediaType) return false;
      if (m.tmdbId !== tmdbId) return false;
      if (mediaType === "tv") {
        return m.season === season && m.episode === episode;
      }
      return true; // movie
    });

    if (!entry) {
      entry = {
        tmdbId,
        type: mediaType,      // "movie" or "tv"
        progress: 0,
        duration: 0,
        addedAt: Date.now(),
      };

      if (mediaType === "tv") {
        entry.season = season;
        entry.episode = episode;
      }

      historyData.push(entry);
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

    let entry = historyData.find(m => String(m.id) === String(id) && m.type === mediaType);

    if (!entry) {
      entry = { id: isNaN(Number(id)) ? id : Number(id), type: mediaType, progress: 0, duration: 0, addedAt: Date.now() };
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



// ---- Initial Load ----
loadHistory();
loadWatchlist();
fetchMovies("/movie/now_playing", "newMovies", "movie");
fetchMovies("/movie/popular", "popularMovies", "movie");
fetchMovies("/movie/top_rated", "topRatedMovies", "movie");
fetchMovies("/tv/popular", "popularTV", "tv");
fetchMovies("/tv/top_rated", "topRatedTV", "tv");
renderContinueWatching();
