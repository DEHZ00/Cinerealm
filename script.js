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

// State
let historyData = [];
let watchlistData = [];
let currentlyPlaying = null;
let isLoading = false;
let currentPage = "home";

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
    <p>${title}</p>
  `;

  card.querySelector(".play-btn").onclick = (e) => {
    e.stopPropagation();
    loadPlayer(movie.id, type, title);
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
  { name: "NovaReel",  key: "spenEmbed", supports: { movie: true, tv: true, anime: true } },
  { name: "FluxLine",  key: "vidplus",   supports: { movie: true, tv: true, anime: true } }, // default
  { name: "PulseView", key: "vidfast",   supports: { movie: true, tv: true, anime: false } },
  { name: "King",      key: "vidking",   supports: { movie: true, tv: true, anime: false } },
  { name: "Ez",        key: "videasy",   supports: { movie: true, tv: true, anime: true } }
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
  let base = "";
  if (t === "movie") {
    base = `https://player.vidplus.to/embed/movie/${id}`;
  } else if (t === "tv") {
    base = `https://player.vidplus.to/embed/tv/${id}/${media.season || 1}/${media.episode || 1}`;
  } else if (t === "anime") {
    base = `https://player.vidplus.to/embed/anime/${media.anilistId || id}/${media.episode || 1}`;
  }

  // Set default options
  const params = {
    autoplay: opts.autoplay ?? true,
    autoNext: opts.autoNext ?? true,
    nextButton: opts.nextButton ?? true,
    poster: opts.poster ?? true,
    title: opts.title ?? true,
    watchparty: opts.watchparty ?? false,
    chromecast: opts.chromecast ?? true,
    episodelist: opts.episodeSelector ?? true,
    servericon: opts.servericon ?? true,
    primarycolor: (opts.color || "#6C63FF").replace("#", ""),
    secondarycolor: (opts.secondaryColor || "#9F9BFF").replace("#", ""),
    iconcolor: (opts.iconColor || "#FFFFFF").replace("#", ""),
    font: opts.font || "Roboto",
    fontcolor: (opts.fontcolor || "#FFFFFF").replace("#", ""),
    fontsize: opts.fontsize || 20,
    opacity: opts.opacity ?? 0.5,
    setting: true,   // required now
    pip: true,       // required now
    logourl: opts.logourl || "https://i.ibb.co/67wTJd9R/pngimg-com-netflix-PNG11.png",
    server: opts.server ?? undefined,
    progress: opts.progress ?? 0,
    dub: opts.dub ?? false
  };

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
      const base = `https://player.videasy.net/anime/${media.anilistId || id}/${media.episode || 1}`;
      const params = {};
      if (opts.dub !== undefined) params.dub = opts.dub ? "true" : "false";
      if (opts.color) params.color = opts.color.replace("#", "");
      return base + buildQuery(params);
    }
  }

  // fallback
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

  PROVIDERS.forEach(p => {
    if (!p.supports[media.type]) return; // skip incompatible providers
    const btn = document.createElement("button");
    btn.className = "source-tab";
    btn.type = "button";
    btn.dataset.key = p.key;
    btn.textContent = p.name;
    if (p.name === defaultName) btn.classList.add("active");

    btn.addEventListener("click", () => {
      // highlight
      scroll.querySelectorAll(".source-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
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
async function renderSeasonsDropdown(tvId, media, extraOpts) {
  const container = document.getElementById("player-season-dropdown");
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
// Set the dropdown to the season currently playing
if (extraOpts.season) {
  seasonSelect.value = extraOpts.season;
}

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

  // Scroll functionality
  leftBtn.addEventListener("click", () => episodeList.scrollBy({ left: -300, behavior: "smooth" }));
  rightBtn.addEventListener("click", () => episodeList.scrollBy({ left: 300, behavior: "smooth" }));

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

  // Listen to dropdown changes
  seasonSelect.addEventListener("change", (e) => loadEpisodes(parseInt(e.target.value)));

  // Load first season by default
  loadEpisodes(seasons[0].season_number);
}



function getHistoryProgress(tmdbId, type, season, episode) {
  if (!historyData || !Array.isArray(historyData)) return 0;

  const match = historyData.find(item => {
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
  const container = document.getElementById('continueWatching');
  if (!container) return;
  container.innerHTML = ''; // Clear previous content

  if (!historyData || historyData.length === 0) {
    container.innerHTML = `<p class="placeholder">No movies to continue watching</p>`;
    return;
  }
 
  const validEntries = historyData.filter(item => item && item.id);
  if (validEntries.length === 0) {
    container.innerHTML = `<p class="placeholder">No movies to continue watching</p>`;
    return;
  }


  for (const entry of validEntries) {
    const type = entry.type || "movie"; // default to movie
    const movieId = entry.id;

    const data = await apiCall(`/${type}/${movieId}`);
    if (!data) continue; // skip failed fetches

    const card = createMovieCard(data, type);
    if (card) container.appendChild(card);
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
document.getElementById("searchBar").addEventListener("keyup", async (e) => {
  if (e.key !== "Enter") return;
  const query = e.target.value.trim();
  if (!query) {
    showError("Please enter a search term");
    return;
  }

  console.log("Searching for:", query);
  const data = await apiCall("/search/multi", { query });
  
  console.log("Search results:", data);
  
  if (!data || !data.results) {
    console.warn("No results in response");
    playerDiv.innerHTML = "<p class='placeholder'>No results found</p>";
    return;
  }

  console.log("Total results:", data.results.length);
  
  // Create search results container
  playerDiv.innerHTML = "";
  const searchSection = document.createElement("section");
  searchSection.innerHTML = "<h2>Search Results</h2>";
  
  const row = document.createElement("div");
  row.className = "movie-row";

  const filtered = data.results.filter(item => item.poster_path && (item.media_type === "movie" || item.media_type === "tv"));
  console.log("Filtered results:", filtered.length);

  filtered.forEach(item => {
    const card = createMovieCard(item, item.media_type);
    if (card) row.appendChild(card);
  });

  if (row.children.length === 0) {
    searchSection.innerHTML += "<p class='placeholder'>No results with posters found</p>";
  } else {
    searchSection.appendChild(row);
  }

  playerDiv.appendChild(searchSection);
  playerDiv.scrollIntoView({ behavior: 'smooth' });
});

// ---- Navigation ----
document.getElementById("homeLink").addEventListener("click", () => {
  switchPage("home");
});

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const page = btn.dataset.page;
    switchPage(page);
    
    if (page === "watchlist") renderWatchlist();
    if (page === "trending") renderTrending();
  });
});

// ---- Listen for Vidking progress events ----
window.addEventListener("message", function(event) {
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

    const { currentTime, duration, id, mediaType } = msg.data;
    let entry = historyData.find(m => m.id === parseInt(id) && m.type === mediaType);

    if (!entry) {
      entry = { id: parseInt(id), type: mediaType, progress: 0, duration: 0, addedAt: Date.now() };
      historyData.push(entry);
    }

    entry.progress = currentTime;
    entry.duration = duration;
    entry.addedAt = Date.now();
    saveHistory();
    
    if (msg.data.event === "ended") {
      renderContinueWatching();
    }
  } catch (err) {
    // Ignore
  }
});

// ---- Initial Load ----
loadHistory();
loadWatchlist();
fetchMovies("/movie/now_playing", "newMovies", "movie");
fetchMovies("/movie/popular", "popularMovies", "movie");
fetchMovies("/movie/top_rated", "topRatedMovies", "movie");
fetchMovies("/tv/popular", "popularTV", "tv");
fetchMovies("/tv/top_rated", "topRatedTV", "tv");
renderContinueWatching();