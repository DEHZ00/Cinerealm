// movies.js — infinite scroll
// uses apiCall(), createMovieCard() from script.js

let _mvPage = 1;
let _mvTotalPages = 1;
let _mvLoading = false;
let _mvDone = false;
let _mvGenres = [];
const _mvSelected = new Set();

const resultsEl  = document.getElementById("moviesResults");
const metaEl     = document.getElementById("moviesMeta");
const panelEl    = document.getElementById("genresPanel");
const loadingEl  = document.getElementById("mvLoadingIndicator");
const badgeEl    = document.getElementById("genreCountBadge");

// ── Genre chips ────────────────────────────────────────────────────────────
async function loadGenres() {
  try {
    const data = await apiCall("/genre/movie/list");
    _mvGenres = data?.genres || [];
    renderGenres();
  } catch(e) {}
}

function renderGenres() {
  panelEl.innerHTML = "";
  _mvGenres.forEach(g => {
    const chip = document.createElement("div");
    chip.className = "genre-chip" + (_mvSelected.has(g.id) ? " active" : "");
    chip.textContent = g.name;
    chip.onclick = () => {
      if (_mvSelected.has(g.id)) _mvSelected.delete(g.id);
      else _mvSelected.add(g.id);
      chip.classList.toggle("active");
      // Update badge
      if (badgeEl) {
        badgeEl.textContent = _mvSelected.size;
        badgeEl.style.display = _mvSelected.size ? "inline-flex" : "none";
      }
    };
    panelEl.appendChild(chip);
  });
}

// ── Build params ───────────────────────────────────────────────────────────
function buildParams(page) {
  const sort_by = document.getElementById("moviesSort").value;
  const yf = parseInt(document.getElementById("yearFrom").value || "2000", 10);
  const yt = parseInt(document.getElementById("yearTo").value || "2025", 10);
  const y1 = Math.max(1900, Math.min(2100, isNaN(yf) ? 2000 : yf));
  const y2 = Math.max(1900, Math.min(2100, isNaN(yt) ? 2025 : yt));
  const p = {
    page, sort_by,
    include_adult: "false",
    include_video: "false",
    "primary_release_date.gte": `${Math.min(y1,y2)}-01-01`,
    "primary_release_date.lte": `${Math.max(y1,y2)}-12-31`,
  };
  if (_mvSelected.size) p.with_genres = [..._mvSelected].join(",");
  return p;
}

// ── Load a page ────────────────────────────────────────────────────────────
async function loadMoviesPage(reset) {
  if (_mvLoading || (!reset && _mvDone)) return;
  _mvLoading = true;

  if (reset) {
    _mvPage = 1;
    _mvDone = false;
    resultsEl.innerHTML = "";
  }

  // Show skeletons on first page, spinner on subsequent
  if (_mvPage === 1) {
    for (let i = 0; i < 12; i++) {
      const s = document.createElement("div");
      s.className = "mv-skeleton";
      s.dataset.skeleton = "1";
      resultsEl.appendChild(s);
    }
  } else {
    if (loadingEl) loadingEl.style.display = "flex";
  }

  try {
    const data = await apiCall("/discover/movie", buildParams(_mvPage));

    // Remove skeletons
    resultsEl.querySelectorAll("[data-skeleton]").forEach(s => s.remove());
    if (loadingEl) loadingEl.style.display = "none";

    _mvTotalPages = Math.min(data?.total_pages || 1, 500);
    const total = data?.total_results || 0;
    const items = (data?.results || []).filter(m => m.poster_path);

    // Update meta
    if (metaEl) {
      const shown = Math.min(_mvPage * 20, total);
      metaEl.textContent = total
        ? `${shown.toLocaleString()} of ${total.toLocaleString()} movies`
        : "No results";
    }

    if (!items.length && _mvPage === 1) {
      resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:rgba(255,255,255,0.3);">No movies found — try different filters.</div>`;
      _mvDone = true;
      _mvLoading = false;
      return;
    }

    items.forEach(m => {
      const card = createMovieCard(m, "movie");
      if (card) resultsEl.appendChild(card);
    });

    if (_mvPage >= _mvTotalPages) {
      _mvDone = true;
      if (_mvPage > 1) {
        const end = document.createElement("div");
        end.className = "mv-end";
        end.textContent = `✓ All ${total.toLocaleString()} movies loaded`;
        resultsEl.appendChild(end);
      }
    } else {
      _mvPage++;
    }
  } catch(e) {
    resultsEl.querySelectorAll("[data-skeleton]").forEach(s => s.remove());
    if (loadingEl) loadingEl.style.display = "none";
    if (_mvPage === 1) {
      resultsEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:rgba(255,255,255,0.3);">
        Failed to load. <button onclick="loadMoviesPage(false)" class="nav-btn" style="margin-left:8px;">Retry</button>
      </div>`;
    }
  }

  _mvLoading = false;
}

// ── Infinite scroll ────────────────────────────────────────────────────────
function initInfiniteScroll() {
  const sentinel = document.getElementById("mvSentinel");
  if (!sentinel) return;
  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !_mvLoading && !_mvDone) {
      loadMoviesPage(false);
    }
  }, { rootMargin: "600px" });
  obs.observe(sentinel);
}

// ── UI wiring ──────────────────────────────────────────────────────────────
function hookUI() {
  // Genres toggle
  document.getElementById("toggleGenres").onclick = () => {
    const open = panelEl.style.display !== "none";
    panelEl.style.display = open ? "none" : "flex";
    document.getElementById("toggleGenres").classList.toggle("active", !open);
  };

  // Apply
  document.getElementById("applyMoviesFilters").onclick = () => {
    loadMoviesPage(true);
    panelEl.style.display = "none";
    document.getElementById("toggleGenres").classList.remove("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Clear
  document.getElementById("clearMoviesFilters").onclick = () => {
    _mvSelected.clear();
    if (badgeEl) { badgeEl.textContent = "0"; badgeEl.style.display = "none"; }
    document.getElementById("moviesSort").value = "popularity.desc";
    document.getElementById("yearFrom").value   = "2000";
    document.getElementById("yearTo").value     = "2025";
    renderGenres();
    loadMoviesPage(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Enter key on year inputs
  ["yearFrom","yearTo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("keydown", e => {
      if (e.key === "Enter") document.getElementById("applyMoviesFilters").click();
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  await loadGenres();
  hookUI();
  initInfiniteScroll();
  loadMoviesPage(true);
});
