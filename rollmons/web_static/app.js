const state = {
  matrix: null,
  bosses: [],
  sessionId: null,
  gauntletRunning: false,
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
  const source = set.source === "smogon" ? "Smogon" : "Randbats";
  const roles = set.role_count > 1
    ? `${set.role_count} ${source} sets; selected at battle assembly`
    : `1 ${source} set`;
  if (set.export) {
    return `
      <div class="set-details" aria-label="${pokemon.name} representative set">
        <p class="role-note">${roles}${set.format ? ` · ${set.format}` : ""}</p>
        <pre class="pokepaste-set">${escapeHtml(set.export)}</pre>
      </div>`;
  }
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
      button.className = `matrix-cell ${cell.state}`;
      button.dataset.cell = `${type}-${generation}`;
      button.innerHTML = `${cell.eligible_count}<small>${cell.state}</small>`;
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
    ? `<ol class="pokemon-list cell-pokemon-list">${cell.pokemon.map(item => `
        <li>
          <span class="cell-pokemon-sprite-frame hotlink-frame">
            <img class="cell-pokemon-sprite hotlinked-asset" src="${item.sprite_url}" alt="">
          </span>
          <span class="cell-pokemon-info">
            <strong>${item.name}</strong> · Gen ${item.debut_generation} · BST ${item.base_stat_total}<br>
            ${chips(item)}
          </span>
        </li>`).join("")}</ol>`
    : "<p>No active-source atoms occupy this cell.</p>";
  detail.innerHTML = `
    <h3>${cell.type} · Gen ${cell.generation}</h3>
    <p><strong>${cell.eligible_count}</strong> eligible · ${
      cell.state === "excluded"
        ? "Excluded from rolls"
        : cell.state === "thin"
          ? "Thin: draftable with a reroll"
          : "Included in rolls"
    }</p>
    ${pokemon}`;
  activateImageFallbacks(detail);
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

function renderBosses(bosses) {
  state.bosses = bosses;
  const select = document.querySelector("#boss-select");
  const button = document.querySelector("#battle-boss");
  const gauntletButton = document.querySelector("#start-gauntlet");
  select.replaceChildren(...bosses.map(boss => {
    const option = document.createElement("option");
    option.value = boss.id;
    option.textContent = boss.name;
    return option;
  }));
  select.disabled = bosses.length === 0;
  button.disabled = bosses.length === 0;
  gauntletButton.disabled = bosses.length === 0;
  if (bosses.length === 0) {
    document.querySelector("#battle-status").textContent =
      "No boss files found under rollmons/bosses/.";
  }
}

function renderGauntlet(gauntlet) {
  const list = document.querySelector("#gauntlet-list");
  if (!gauntlet || !gauntlet.bosses.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = gauntlet.bosses.map((boss, index) => {
    const result = gauntlet.results[index];
    const status = result
      ? `${result.winner === "tie" ? "Tie" : `${result.winner} win`} · ${result.turns} turns`
      : boss.current
        ? "Running next"
        : boss.complete
          ? "Complete"
          : "Waiting";
    return `
      <li class="${boss.current ? "current" : ""} ${result ? "complete" : ""}">
        <span>${index + 1}. ${boss.name}</span>
        <small>${status}</small>
      </li>`;
  }).join("");
}

function renderDraft(draft) {
  state.sessionId = draft.session_id;
  renderTeam(draft.team);
  renderGauntlet(draft.gauntlet);
  const status = document.querySelector("#draft-status");
  const offerRoot = document.querySelector("#current-offer");
  const candidates = document.querySelector("#candidate-list");
  const exportPanel = document.querySelector("#team-export-panel");
  const battlePanel = document.querySelector("#battle-panel");

  if (draft.complete) {
    status.innerHTML = `<strong>Draft complete.</strong> Six unique Pokémon assembled at level ${draft.level}.`;
    offerRoot.innerHTML = "";
    candidates.innerHTML = "";
    document.querySelector("#team-export").textContent = draft.team_export;
    exportPanel.classList.remove("hidden");
    battlePanel.classList.remove("hidden");
    if (draft.battle_result) renderBattleResult(draft.battle_result);
    else battlePanel.scrollIntoView({behavior: "smooth", block: "center"});
    return;
  }

  exportPanel.classList.add("hidden");
  battlePanel.classList.add("hidden");
  document.querySelector("#battle-result-panel").classList.add("hidden");
  status.innerHTML = `<strong>Round ${draft.offer.round_number}/6</strong> · ${draft.offer.candidates.length} undrafted candidates`;
  const thinReroll = draft.offer.thin_reroll_available
    ? `<button id="thin-reroll" class="thin-reroll-button">Thin cell — reroll available</button>`
    : "";
  offerRoot.innerHTML = `
    <div class="offer-heading">
      <div>
        <p class="eyebrow">Current cell</p>
        <h3>${draft.offer.cell.type} · Gen ${draft.offer.cell.generation}</h3>
        ${draft.offer.thin_reroll_available ? "<p class=\"thin-note\">Only 1–2 undrafted choices remain.</p>" : ""}
      </div>
      <div class="offer-actions">
        ${thinReroll}
        <button id="skip-draft" class="skip-button" ${draft.skips_remaining ? "" : "disabled"}>
          Skip (${draft.skips_remaining})
        </button>
      </div>
    </div>`;
  document.querySelector("#skip-draft").addEventListener("click", skipDraft);
  document.querySelector("#thin-reroll")?.addEventListener("click", thinRerollDraft);
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

async function thinRerollDraft() {
  renderDraft(await api(
    `/api/drafts/${state.sessionId}/thin-reroll`,
    {method: "POST"},
  ));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function replayDocument(replayLog) {
  const protocol = escapeHtml(replayLog.join("\n"));
  return `<!doctype html>
<meta charset="utf-8">
<style>
html, body { margin: 0; padding: 0; font-family: Verdana, sans-serif; }
.wrapper { max-width: 1180px; margin: 0 auto; }
</style>
<div class="wrapper replay-wrapper">
  <div class="battle"></div>
  <div class="battle-log"></div>
  <div class="replay-controls"></div>
  <div class="replay-controls-2"></div>
  <script type="text/plain" class="battle-log-data">${protocol}<\/script>
</div>
<script src="https://play.pokemonshowdown.com/js/replay-embed.js"><\/script>`;
}

function renderBattleResult(result) {
  const label = result.winner === "tie"
    ? "Tie"
    : `${result.winner === "player" ? result.player_name : result.boss_name} wins`;
  document.querySelector("#battle-result").textContent =
    `${label} in ${result.turns} turns`;
  document.querySelector("#battle-id").textContent = result.battle_id;
  document.querySelector("#battle-replay").srcdoc = replayDocument(result.replay_log);
  document.querySelector("#battle-result-panel").classList.remove("hidden");
  document.querySelector("#battle-status").textContent = "Battle complete.";
}

async function battleBoss() {
  const button = document.querySelector("#battle-boss");
  const bossId = document.querySelector("#boss-select").value;
  const status = document.querySelector("#battle-status");
  if (!bossId) {
    status.textContent = "Select a boss before starting the battle.";
    return;
  }
  button.disabled = true;
  status.textContent = "Running live battle…";
  try {
    const draft = await api(`/api/drafts/${state.sessionId}/battle`, {
      method: "POST",
      body: JSON.stringify({boss_id: bossId}),
    });
    renderDraft(draft);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function startGauntlet() {
  const button = document.querySelector("#start-gauntlet");
  const singleBattleButton = document.querySelector("#battle-boss");
  const status = document.querySelector("#battle-status");
  button.disabled = true;
  singleBattleButton.disabled = true;
  state.gauntletRunning = true;
  status.textContent = "Validating boss teams…";
  try {
    const draft = await api(`/api/drafts/${state.sessionId}/gauntlet/start`, {
      method: "POST",
      body: JSON.stringify({boss_ids: state.bosses.map(boss => boss.id)}),
    });
    renderDraft(draft);
    await runNextGauntletBattle();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
  }
}

async function runNextGauntletBattle() {
  const status = document.querySelector("#battle-status");
  const button = document.querySelector("#start-gauntlet");
  const singleBattleButton = document.querySelector("#battle-boss");
  try {
    const currentState = await api(`/api/drafts/${state.sessionId}`);
    if (currentState.gauntlet.complete) {
      renderDraft(currentState);
      status.textContent = "Boss rush complete.";
      button.disabled = false;
      singleBattleButton.disabled = false;
      state.gauntletRunning = false;
      return;
    }
    const nextBoss = currentState.gauntlet.bosses[currentState.gauntlet.next_index];
    status.textContent = `Running battle ${currentState.gauntlet.next_index + 1}/${currentState.gauntlet.bosses.length}: ${nextBoss.name}…`;
    renderGauntlet(currentState.gauntlet);
    const nextState = await api(`/api/drafts/${state.sessionId}/gauntlet/next`, {
      method: "POST",
    });
    renderDraft(nextState);
    if (!nextState.gauntlet.complete) {
      setTimeout(runNextGauntletBattle, 250);
      return;
    }
    status.textContent = "Boss rush complete.";
    button.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
  }
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
document.querySelector("#battle-boss").addEventListener("click", battleBoss);
document.querySelector("#start-gauntlet").addEventListener("click", startGauntlet);
renderTeam([]);

api("/api/matrix").then(matrix => {
  state.matrix = matrix;
  renderMatrix();
}).catch(error => {
  document.querySelector("#matrix-summary").textContent = error.message;
});

api("/api/bosses").then(renderBosses).catch(error => {
  document.querySelector("#battle-status").textContent = error.message;
});
