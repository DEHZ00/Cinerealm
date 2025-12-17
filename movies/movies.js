// movies.js - uses apiCall(), createMovieCard(), showError() from script.js

let page = 1;
let totalPages = 1;
let totalResults = 0;

let genres = [];
const selected = new Set();

const resultsEl = document.getElementById("moviesResults");
const metaEl = document.getElementById("moviesMeta");
const panelEl = document.getElementById("genresPanel");

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

async function loadGenres(){
  const data = await apiCall("/genre/movie/list");
  genres = data?.genres || [];
  renderGenres();
}

function renderGenres(){
  panelEl.innerHTML = "";
  if (!genres.length){
    panelEl.innerHTML = `<p class="placeholder" style="padding:10px;">No genres found</p>`;
    return;
  }

  for (const g of genres){
    const chip = document.createElement("div");
    chip.className = "genre-chip" + (selected.has(g.id) ? " active" : "");
    chip.textContent = g.name;

    chip.onclick = () => {
      if (selected.has(g.id)) selected.delete(g.id);
      else selected.add(g.id);
      chip.classList.toggle("active");
    };

    panelEl.appendChild(chip);
  }
}

function buildParams(){
  const sort_by = document.getElementById("moviesSort").value;
  const yf = parseInt(document.getElementById("yearFrom").value || "2000", 10);
  const yt = parseInt(document.getElementById("yearTo").value || "2025", 10);

  const y1 = clamp(isNaN(yf) ? 2000 : yf, 1900, 2100);
  const y2 = clamp(isNaN(yt) ? 2025 : yt, 1900, 2100);

  const params = {
    page,
    sort_by,
    include_adult: "false",
    include_video: "false",
    "primary_release_date.gte": `${Math.min(y1,y2)}-01-01`,
    "primary_release_date.lte": `${Math.max(y1,y2)}-12-31`
  };

  if (selected.size){
    params.with_genres = [...selected].join(",");
  }

  return params;
}

async function loadMovies(){
  resultsEl.innerHTML = "";
  const data = await apiCall("/discover/movie", buildParams());
  const results = data?.results || [];

  page = data?.page || page;
  totalPages = Math.min(data?.total_pages || 1, 500);
  totalResults = data?.total_results || 0;

  const start = totalResults ? (page - 1) * 20 + 1 : 0;
  const end = totalResults ? Math.min(page * 20, totalResults) : 0;
  metaEl.textContent = `Showing ${start}-${end} of ${totalResults} results`;

  if (!results.length){
    resultsEl.innerHTML = `<p class="placeholder">No movies found with those filters.</p>`;
    renderPager();
    return;
  }

  results
    .filter(x => x.poster_path)
    .forEach(m => {
      const card = createMovieCard(m, "movie");
      if (!card) return;
      resultsEl.appendChild(card);
    });

  renderPager();
}

function renderPager(){
  const wrap = document.getElementById("pageBtns");
  wrap.innerHTML = "";

  const maxBtns = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(totalPages, start + maxBtns - 1);
  start = Math.max(1, end - maxBtns + 1);

  for (let p = start; p <= end; p++){
    const b = document.createElement("button");
    b.className = "nav-btn page-btn" + (p === page ? " active" : "");
    b.textContent = String(p);
    b.onclick = () => { page = p; loadMovies(); window.scrollTo({top:0,behavior:"smooth"}); };
    wrap.appendChild(b);
  }

  document.getElementById("firstBtn").disabled = page <= 1;
  document.getElementById("prevBtn").disabled = page <= 1;
  document.getElementById("nextBtn").disabled = page >= totalPages;
  document.getElementById("lastBtn").disabled = page >= totalPages;
}

function hookUI(){
  document.getElementById("toggleGenres").onclick = () => {
    panelEl.style.display = (panelEl.style.display === "none") ? "flex" : "none";
  };

  document.getElementById("applyMoviesFilters").onclick = () => {
    page = 1;
    loadMovies();
  };

  document.getElementById("clearMoviesFilters").onclick = () => {
    selected.clear();
    document.getElementById("moviesSort").value = "popularity.desc";
    document.getElementById("yearFrom").value = 2000;
    document.getElementById("yearTo").value = 2025;
    renderGenres();
    page = 1;
    loadMovies();
  };

  document.getElementById("firstBtn").onclick = () => { page = 1; loadMovies(); };
  document.getElementById("prevBtn").onclick = () => { page = Math.max(1, page - 1); loadMovies(); };
  document.getElementById("nextBtn").onclick = () => { page = Math.min(totalPages, page + 1); loadMovies(); };
  document.getElementById("lastBtn").onclick = () => { page = totalPages; loadMovies(); };
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadGenres();
  hookUI();
  loadMovies();
});
