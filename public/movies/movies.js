// movies.js — bulletproof infinite scroll using scroll event
// depends on apiCall(), createMovieCard() from script.js

let _mvPage = 1;
let _mvTotalPages = 1;
let _mvLoading = false;
let _mvDone = false;
let _mvGenres = [];
const _mvSelected = new Set();

function getEl(id) { return document.getElementById(id); }

// ── Wait for script.js to be ready ─────────────────────────────────────────
function mvReady(fn) {
  if (typeof apiCall === "function" && typeof createMovieCard === "function") { fn(); return; }
  let t = 0;
  const iv = setInterval(() => {
    t++;
    if (typeof apiCall === "function" && typeof createMovieCard === "function") {
      clearInterval(iv); fn();
    }
    if (t > 100) clearInterval(iv);
  }, 50);
}

// ── Genres ─────────────────────────────────────────────────────────────────
async function mvLoadGenres() {
  try {
    const data = await apiCall("/genre/movie/list");
    _mvGenres = data?.genres || [];
    mvRenderGenres();
  } catch(e) {}
}

function mvRenderGenres() {
  const panel = getEl("genresPanel");
  const badge = getEl("genreCountBadge");
  if (!panel) return;
  panel.innerHTML = "";
  _mvGenres.forEach(g => {
    const chip = document.createElement("div");
    chip.className = "genre-chip" + (_mvSelected.has(g.id) ? " active" : "");
    chip.textContent = g.name;
    chip.onclick = () => {
      _mvSelected.has(g.id) ? _mvSelected.delete(g.id) : _mvSelected.add(g.id);
      chip.classList.toggle("active");
      if (badge) { badge.textContent = _mvSelected.size; badge.style.display = _mvSelected.size ? "inline-flex" : "none"; }
    };
    panel.appendChild(chip);
  });
}

// ── Params ──────────────────────────────────────────────────────────────────
function mvParams(page) {
  const sort  = getEl("moviesSort")?.value || "popularity.desc";
  const yf    = parseInt(getEl("yearFrom")?.value || "2000", 10);
  const yt    = parseInt(getEl("yearTo")?.value   || "2025", 10);
  const y1    = Math.max(1900, Math.min(2100, isNaN(yf) ? 2000 : yf));
  const y2    = Math.max(1900, Math.min(2100, isNaN(yt) ? 2025 : yt));
  const p = {
    page, sort_by: sort,
    include_adult: "false", include_video: "false",
    "primary_release_date.gte": `${Math.min(y1,y2)}-01-01`,
    "primary_release_date.lte": `${Math.max(y1,y2)}-12-31`,
  };
  if (_mvSelected.size) p.with_genres = [..._mvSelected].join(",");
  return p;
}

// ── Load page ───────────────────────────────────────────────────────────────
async function mvLoad(reset) {
  if (_mvLoading) return;
  if (!reset && _mvDone) return;
  _mvLoading = true;

  const results = getEl("moviesResults");
  const meta    = getEl("moviesMeta");
  const spinner = getEl("mvSpinner");

  if (reset) {
    _mvPage = 1;
    _mvDone = false;
    if (results) results.innerHTML = "";
  }

  // Show skeletons on first page
  if (_mvPage === 1 && results) {
    results.innerHTML = Array(12).fill(`<div class="mv-skeleton"></div>`).join("");
  }
  if (spinner) spinner.style.display = _mvPage > 1 ? "flex" : "none";

  try {
    const data  = await apiCall("/discover/movie", mvParams(_mvPage));
    const total = data?.total_results || 0;
    const items = (data?.results || []).filter(m => m.poster_path);
    _mvTotalPages = Math.min(data?.total_pages || 1, 500);

    // Clear skeletons without destroying existing cards
    if (reset && results) results.innerHTML = "";
    if (results) results.querySelectorAll(".mv-skeleton").forEach(s => s.remove());
    if (spinner) spinner.style.display = "none";

    // Update meta
    if (meta) meta.textContent = total ? `${Math.min(_mvPage*20,total).toLocaleString()} of ${total.toLocaleString()} movies` : "No results";

    if (!items.length && _mvPage === 1) {
      if (results) results.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:rgba(255,255,255,0.3);">No movies found — try different filters.</div>`;
      _mvDone = true; _mvLoading = false; return;
    }

    items.forEach(m => {
      const card = createMovieCard(m, "movie");
      if (card && results) results.appendChild(card);
    });

    if (_mvPage >= _mvTotalPages) {
      _mvDone = true;
      if (results && _mvPage > 1) {
        const end = document.createElement("div");
        end.className = "mv-end";
        end.textContent = `✓ All ${total.toLocaleString()} movies loaded`;
        results.appendChild(end);
      }
    } else {
      _mvPage++;
    }

  } catch(e) {
    if (results) results.querySelectorAll(".mv-skeleton").forEach(s => s.remove());
    if (spinner) spinner.style.display = "none";
    if (_mvPage === 1 && results) {
      results.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:rgba(255,255,255,0.3);">
        Failed to load. <button onclick="mvLoad(false)" class="nav-btn">Retry</button></div>`;
    }
  }

  _mvLoading = false;
}

// ── Scroll-based infinite load (bulletproof) ─────────────────────────────
function mvCheckScroll() {
  if (_mvLoading || _mvDone) return;
  const scrolled  = window.scrollY + window.innerHeight;
  const total     = document.documentElement.scrollHeight;
  // Load more when within 600px of the bottom
  if (total - scrolled < 600) {
    mvLoad(false);
  }
}

// ── UI ──────────────────────────────────────────────────────────────────────
function mvHookUI() {
  const panel = getEl("genresPanel");

  getEl("toggleGenres")?.addEventListener("click", () => {
    if (!panel) return;
    const open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "flex";
    getEl("toggleGenres").classList.toggle("active", !open);
  });

  getEl("applyMoviesFilters")?.addEventListener("click", () => {
    if (panel) panel.style.display = "none";
    getEl("toggleGenres")?.classList.remove("active");
    _mvDone = false;
    mvLoad(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  getEl("clearMoviesFilters")?.addEventListener("click", () => {
    _mvSelected.clear();
    const badge = getEl("genreCountBadge");
    if (badge) { badge.textContent = "0"; badge.style.display = "none"; }
    const sort = getEl("moviesSort"); if (sort) sort.value = "popularity.desc";
    const yf = getEl("yearFrom"); if (yf) yf.value = "2000";
    const yt = getEl("yearTo");   if (yt) yt.value = "2025";
    mvRenderGenres();
    _mvDone = false;
    mvLoad(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  ["yearFrom","yearTo"].forEach(id => {
    getEl(id)?.addEventListener("keydown", e => {
      if (e.key === "Enter") getEl("applyMoviesFilters")?.click();
    });
  });

  // Scroll listener — fires on every scroll, checks if near bottom
  window.addEventListener("scroll", mvCheckScroll, { passive: true });
}

// ── Init ────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  mvReady(async () => {
    await mvLoadGenres();
    mvHookUI();
    mvLoad(true);
  });
});