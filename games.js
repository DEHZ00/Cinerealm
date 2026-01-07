const CDN_JSON =
  "https://raw.githubusercontent.com/swarmintelli/Unblocked-Games-CDN/main/games.json";

let allGames = [];
let filteredGames = [];

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function setStatus(msg, show = true) {
  const el = document.getElementById("gamesStatus");
  if (!el) return;
  el.textContent = msg;
  el.style.display = show ? "block" : "none";
}

function setCount() {
  const el = document.getElementById("gamesCount");
  if (!el) return;
  el.textContent = `${filteredGames.length} games`;
}

function sortGames(mode) {
  const copy = [...filteredGames];
  copy.sort((a, b) => {
    const an = (a.name || "").toLowerCase();
    const bn = (b.name || "").toLowerCase();
    return mode === "za" ? bn.localeCompare(an) : an.localeCompare(bn);
  });
  filteredGames = copy;
}

function makeCard(game) {
  const title = game.name || "Unknown Game";
  const img = game.game_image_icon || "";
  const url = game.game_url;

  const card = document.createElement("div");
  card.className = "movie-card";
  card.style.minWidth = "160px";
  card.style.maxWidth = "160px";

  card.innerHTML = `
    <div class="card-image-wrapper">
      ${
        img
          ? `<img src="${img}" alt="${title}" loading="lazy">`
          : `<div style="width:100%;height:240px;display:flex;align-items:center;justify-content:center;background:#222;">🎮</div>`
      }
      <div class="card-overlay">
        <button class="play-btn">▶ Play</button>
      </div>
    </div>
    <p title="${title}">${title}</p>
  `;

  card.querySelector(".play-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openGame(title, url);
  });

  card.addEventListener("click", () => openGame(title, url));
  return card;
}

function renderGrid() {
  const grid = document.getElementById("gamesGrid");
  if (!grid) return;

  grid.innerHTML = "";
  filteredGames.forEach((g) => grid.appendChild(makeCard(g)));

  setCount();

  if (!filteredGames.length) setStatus("No games match your search.", true);
  else setStatus("", false);
}

function applyFilters() {
  const q = norm(document.getElementById("gamesSearch")?.value);
  const sortMode = document.getElementById("gamesSort")?.value || "az";

  filteredGames = allGames.filter((g) => {
    if (!g?.game_url) return false;
    const name = norm(g.name);
    return !q || name.includes(q);
  });

  sortGames(sortMode);
  renderGrid();
}

// Modal open/close
function openGame(title, url) {
  const modal = document.getElementById("gameModal");
  const frame = document.getElementById("gameFrame");
  const titleEl = document.getElementById("gameTitle");
  const openNewTab = document.getElementById("openNewTab");
  if (!modal || !frame || !titleEl || !openNewTab) return;

  titleEl.textContent = title;
  openNewTab.href = url;

  frame.src = url;
  modal.style.display = "block";
}

function closeGame() {
  const modal = document.getElementById("gameModal");
  const frame = document.getElementById("gameFrame");
  if (!modal || !frame) return;

  frame.src = "about:blank";
  modal.style.display = "none";
}

async function loadGames() {
  try {
    setStatus("Loading games…", true);

    const res = await fetch(CDN_JSON, { cache: "force-cache" });
    if (!res.ok) throw new Error(`Failed to fetch games.json (${res.status})`);

    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid games.json format");

    allGames = data
      .map((g) => ({
        name: g.name || g["game-name"] || "",
        game_url: g.game_url,
        game_image_icon: g.game_image_icon,
        id: g["game-id"] || g.id
      }))
      .filter((g) => g.game_url && g.name);

    applyFilters();
  } catch (e) {
    console.error("Games load error:", e);
    setStatus("Failed to load games. Try again later.", true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("gamesSearch")?.addEventListener("input", applyFilters);
  document.getElementById("gamesSort")?.addEventListener("change", applyFilters);
  document.getElementById("closeGameModal")?.addEventListener("click", closeGame);

  window.addEventListener("click", (e) => {
    const modal = document.getElementById("gameModal");
    if (e.target === modal) closeGame();
  });

  loadGames();
});
