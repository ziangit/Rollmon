const state = {
  matrix: null,
  sessionId: null,
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {"Content-Type": "application/json"},
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.detail || "Request failed");
  return payload;
}

function chips(pokemon) {
  const types = pokemon.types
    .map(type => `<span class="type-chip">${type}</span>`)
    .join("");
  const legendary = pokemon.legendary
    ? `<span class="legendary-marker">Legendary</span>`
    : "";
  return `${types}${legendary}`;
}

function displayId(value) {
  return value.replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function spreadLine(label, values) {
  return `${label}: ${Object.entries(values)
    .map(([stat, value]) => `${value} ${stat}`)
    .join(" / ")}`;
}

function itemIcon(icon, itemName) {
  if (!icon) return "";
  return `
    <span class="item-icon-frame hotlink-frame" title="${displayId(itemName)}">
      <img
        class="item-icon hotlinked-asset"
        src="${icon.url}"
        alt=""
        style="left:${icon.left}px; top:${icon.top}px"
      >
    </span>`;
}

function setDetails(pokemon) {
  const set = pokemon.randbats_set;
  const spread = pokemon.assembly_spread;
  const roles = set.role_count > 1
    ? `${set.role_count} observed roles; showing the most common`
    : "1 observed role";
  return `
    <div class="set-details" aria-label="${pokemon.name} representative set">
      <p class="role-note">${roles}</p>
      <div class="set-first-line">
        <code>${pokemon.name}${set.item ? ` @ ${displayId(set.item)}` : ""}</code>
        ${itemIcon(set.item_icon, set.item)}
      </div>
      <pre class="pokepaste-set">Ability: ${displayId(set.ability)}
Level: ${spread.level}
${spreadLine("EVs", spread.evs)}
${spreadLine("IVs", spread.ivs)}
${spread.nature} Nature
${set.moves.map(move => `- ${displayId(move)}`).join("\n")}</pre>
    </div>`;
}

// DEV-ONLY hotlinks. The sprite/icon images are displayed from Showdown at
// runtime because their redistribution terms are not established; failed
// images are removed while the complete text representation remains usable.
function activateImageFallbacks(root = document) {
  root.querySelectorAll(".hotlinked-asset").forEach(image => {
    const hideFailedImage = () => {
      const frame = image.closest(".hotlink-frame");
      if (frame) frame.classList.add("asset-failed");
      image.remove();
    };
    image.addEventListener("error", hideFailedImage, {once: true});
    if (image.complete && image.naturalWidth === 0) hideFailedImage();
  });
}

function renderMatrix() {
  const grid = document.querySelector("#matrix-grid");
  grid.innerHTML = `<div class="grid-label">Type</div>` +
    state.matrix.generations
      .map(gen => `<div class="grid-label">Gen ${gen}</div>`).join("");

  for (const type of state.matrix.types) {
    grid.insertAdjacentHTML("beforeend", `<div class="grid-label">${type}</div>`);
    for (const generation of state.matrix.generations) {
      const cell = state.matrix.cells.find(
        item => item.type === type && item.generation === generation
      );
      const button = document.createElement("button");
      button.className = `matrix-cell ${cell.included ? "included" : ""}`;
      button.dataset.cell = `${type}-${generation}`;
      button.innerHTML = `${cell.eligible_count}<small>${cell.included ? "included" : "excluded"}</small>`;
      button.addEventListener("click", () => renderCell(cell, button));
      grid.appendChild(button);
    }
  }
  document.querySelector("#matrix-summary").textContent =
    `${state.matrix.included_cell_count} included cells · ${state.matrix.atom_count} draftable atoms`;
}

function renderCell(cell, button) {
  document.querySelectorAll(".matrix-cell").forEach(item => item.classList.remove("selected"));
  button.classList.add("selected");
  const detail = document.querySelector("#cell-detail");
  const pokemon = cell.pokemon.length
    ? `<ol class="pokemon-list">${cell.pokemon.map(item => `
        <li>
          <strong>${item.name}</strong> · Gen ${item.debut_generation} · BST ${item.base_stat_total}<br>
          ${chips(item)}
        </li>`).join("")}</ol>`
    : "<p>No randbats atoms occupy this cell.</p>";
  detail.innerHTML = `
    <h3>${cell.type} · Gen ${cell.generation}</h3>
    <p><strong>${cell.eligible_count}</strong> eligible · ${cell.included ? "Included in rolls" : "Excluded from rolls"}</p>
    ${pokemon}`;
}

function renderTeam(team) {
  const slots = document.querySelector("#team-slots");
  const entries = [...team];
  while (entries.length < 6) entries.push(null);
  slots.innerHTML = entries.map((pokemon, index) => pokemon
    ? `<li><strong>${pokemon.name}</strong><br>${chips(pokemon)}</li>`
    : `<li>Empty slot ${index + 1}</li>`
  ).join("");
}

function renderDraft(draft) {
  state.sessionId = draft.session_id;
  renderTeam(draft.team);
  const status = document.querySelector("#draft-status");
  const offerRoot = document.querySelector("#current-offer");
  const candidates = document.querySelector("#candidate-list");
  const exportPanel = document.querySelector("#team-export-panel");

  if (draft.complete) {
    status.innerHTML = `<strong>Draft complete.</strong> Six unique Pokémon assembled at level ${draft.level}.`;
    offerRoot.innerHTML = "";
    candidates.innerHTML = "";
    document.querySelector("#team-export").textContent = draft.team_export;
    exportPanel.classList.remove("hidden");
    return;
  }

  exportPanel.classList.add("hidden");
  status.innerHTML = `<strong>Round ${draft.offer.round_number}/6</strong> · ${draft.offer.candidates.length} undrafted candidates`;
  offerRoot.innerHTML = `
    <div class="offer-heading">
      <div>
        <p class="eyebrow">Current cell</p>
        <h3>${draft.offer.cell.type} · Gen ${draft.offer.cell.generation}</h3>
      </div>
      <button id="skip-draft" class="skip-button" ${draft.skips_remaining ? "" : "disabled"}>
        Skip (${draft.skips_remaining})
      </button>
    </div>`;
  document.querySelector("#skip-draft").addEventListener("click", skipDraft);
  candidates.innerHTML = draft.offer.candidates.map(pokemon => {
    const suggested = pokemon.id === draft.offer.suggested_species;
    return `
      <article class="candidate-card ${suggested ? "suggested" : ""} ${pokemon.legendary ? "legendary" : ""}">
        <div class="candidate-content">
          <div class="pokemon-visual">
            <span class="pokemon-sprite-frame hotlink-frame">
              <img class="pokemon-sprite hotlinked-asset" src="${pokemon.sprite_url}" alt="">
            </span>
            <strong class="sprite-fallback-name">${pokemon.name}</strong>
            <div>${chips(pokemon)}</div>
            <p>Gen ${pokemon.debut_generation} · BST ${pokemon.base_stat_total}</p>
          </div>
          <div class="candidate-set">
            <div class="candidate-heading">
              <span class="suggestion-label">${suggested ? "Suggested pick" : "Eligible pick"}</span>
              <span class="probability"><strong>${(pokemon.selection_probability * 100).toFixed(2)}%</strong> suggestion probability</span>
            </div>
            ${setDetails(pokemon)}
          </div>
        </div>
        <button class="pick-button" data-species="${pokemon.id}">Pick</button>
      </article>`;
  }).join("");
  activateImageFallbacks(candidates);
  document.querySelectorAll(".pick-button").forEach(button => {
    button.addEventListener("click", () => pickSpecies(button.dataset.species));
  });
}

async function startDraft() {
  try {
    renderDraft(await api("/api/drafts", {
      method: "POST",
      body: JSON.stringify({level: 100, skip_count: 1}),
    }));
  } catch (error) {
    document.querySelector("#draft-status").textContent = error.message;
  }
}

async function pickSpecies(speciesId) {
  renderDraft(await api(`/api/drafts/${state.sessionId}/pick`, {
    method: "POST",
    body: JSON.stringify({species_id: speciesId}),
  }));
}

async function skipDraft() {
  renderDraft(await api(`/api/drafts/${state.sessionId}/skip`, {method: "POST"}));
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach(view => view.classList.add("hidden"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}-view`).classList.remove("hidden");
  });
});
document.querySelector("#start-draft").addEventListener("click", startDraft);
renderTeam([]);

api("/api/matrix").then(matrix => {
  state.matrix = matrix;
  renderMatrix();
}).catch(error => {
  document.querySelector("#matrix-summary").textContent = error.message;
});
