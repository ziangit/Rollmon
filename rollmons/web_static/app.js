const state = {
  matrix: null,
  bosses: [],
  sessionId: null,
  gauntletRunning: false,
  teamExport: "",
};
const MIN_BOSSES = 1;
const MAX_BOSSES = 10;

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
    .map(type => `<span class="type-chip type-${type.toLowerCase()}">${type}</span>`)
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

function setDetails(pokemon, options = {}) {
  const showRoleNote = options.showRoleNote !== false;
  const set = pokemon.randbats_set;
  const spread = pokemon.assembly_spread;
  const source = set.source === "smogon" ? "Smogon" : "Randbats";
  const roles = set.role_count > 1
    ? `${set.role_count} ${source} sets; selected at battle assembly`
    : `1 ${source} set`;
  if (set.export) {
    return `
      <div class="set-details" aria-label="${pokemon.name} representative set">
        ${showRoleNote ? `<p class="role-note">${roles}${set.format ? ` · ${set.format}` : ""}</p>` : ""}
        <pre class="pokepaste-set">${escapeHtml(set.export)}</pre>
      </div>`;
  }
  return `
    <div class="set-details" aria-label="${pokemon.name} representative set">
      ${showRoleNote ? `<p class="role-note">${roles}</p>` : ""}
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
  const copyButton = document.querySelector("#copy-team-export");
  const entries = [...team];
  while (entries.length < 6) entries.push(null);
  slots.innerHTML = entries.map((pokemon, index) => pokemon
    ? `<li class="team-card">
        <div class="team-card-heading">
          <span class="team-pokemon-sprite-frame hotlink-frame">
            <img class="team-pokemon-sprite hotlinked-asset" src="${pokemon.sprite_url}" alt="">
          </span>
          <div class="team-pokemon-meta">
            <strong>${pokemon.name}</strong>
            <div>${chips(pokemon)}</div>
            <p>Gen ${pokemon.debut_generation} · BST ${pokemon.base_stat_total}</p>
          </div>
        </div>
        ${setDetails(pokemon, {showRoleNote: false})}
      </li>`
    : `<li class="team-empty">Empty slot ${index + 1}</li>`
  ).join("");
  if (copyButton) copyButton.disabled = !state.teamExport;
  activateImageFallbacks(slots);
}

function gauntletReport(gauntlet) {
  if (gauntlet?.summary) return gauntlet.summary;
  if (!gauntlet?.complete || !gauntlet.results.length) return "";
  const wins = gauntlet.results.filter(result => result.winner === "player").length;
  const losses = gauntlet.results.filter(result => result.winner === "boss").length;
  const ties = gauntlet.results.filter(result => result.winner === "tie").length;
  const turnTotal = gauntlet.results.reduce((total, result) => total + result.turns, 0);
  const averageTurns = turnTotal / gauntlet.results.length;
  const record = ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
  return `Your record is ${record}! Average turn is ${averageTurns.toFixed(1)}.`;
}

function renderBosses(bosses) {
  state.bosses = bosses;
  const select = document.querySelector("#boss-select");
  const button = document.querySelector("#battle-boss");
  const gauntletButton = document.querySelector("#start-gauntlet");
  const realGauntletButton = document.querySelector("#start-real-gauntlet");
  const orderList = document.querySelector("#boss-order-list");
  const addButton = document.querySelector("#save-boss");
  select.replaceChildren(...bosses.map(boss => {
    const option = document.createElement("option");
    option.value = boss.id;
    option.textContent = bossDisplayName(boss);
    return option;
  }));
  orderList.innerHTML = bosses.map((boss, index) => `
    <li data-boss-id="${boss.id}" data-index="${index}" draggable="true">
      <span class="boss-drag-handle" aria-hidden="true">::</span>
      <span>${index + 1}. ${escapeHtml(bossDisplayName(boss))}</span>
      <span class="boss-order-actions">
        <button class="copy-button boss-edit" data-index="${index}">Edit</button>
        <button class="copy-button boss-discard" data-index="${index}" ${bosses.length <= MIN_BOSSES ? "disabled" : ""}>Discard</button>
      </span>
    </li>
  `).join("");
  orderList.querySelectorAll("li").forEach(item => {
    item.addEventListener("dragstart", event => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.dataset.index);
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));
    item.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      item.classList.add("drag-over");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
    item.addEventListener("drop", event => {
      event.preventDefault();
      orderList.querySelectorAll(".drag-over").forEach(row => row.classList.remove("drag-over"));
      dragBoss(
        Number(event.dataTransfer.getData("text/plain")),
        Number(item.dataset.index),
      );
    });
  });
  orderList.querySelectorAll(".boss-edit").forEach(button => {
    button.addEventListener("click", () => editBoss(Number(button.dataset.index)));
  });
  orderList.querySelectorAll(".boss-discard").forEach(button => {
    button.addEventListener("click", () => discardBoss(Number(button.dataset.index)));
  });
  select.disabled = bosses.length === 0;
  button.disabled = bosses.length === 0;
  gauntletButton.disabled = bosses.length === 0;
  realGauntletButton.disabled = bosses.length === 0;
  if (!document.querySelector("#custom-boss-id").value) {
    addButton.disabled = bosses.length >= MAX_BOSSES;
  }
  if (bosses.length === 0) {
    document.querySelector("#battle-status").textContent =
      "No boss files found under rollmons/bosses/.";
  }
}

function bossDisplayName(boss) {
  if (boss.source === "custom") return `${boss.name} (pasted)`;
  if (boss.source === "edited") return `${boss.name} (edited)`;
  return boss.name;
}

function dragBoss(fromIndex, toIndex) {
  if (
    Number.isNaN(fromIndex)
    || Number.isNaN(toIndex)
    || fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= state.bosses.length
    || toIndex >= state.bosses.length
  ) {
    return;
  }
  const bosses = [...state.bosses];
  const [moved] = bosses.splice(fromIndex, 1);
  bosses.splice(toIndex, 0, moved);
  renderBosses(bosses);
}

function orderedBossIds() {
  return state.bosses.map(boss => boss.id);
}

function discardBoss(index) {
  const status = document.querySelector("#custom-boss-status");
  if (state.bosses.length <= MIN_BOSSES) {
    status.textContent = "At least one boss must remain.";
    return;
  }
  const bosses = state.bosses.filter((_boss, bossIndex) => bossIndex !== index);
  renderBosses(bosses);
  resetBossForm();
  status.textContent = "Boss removed from the current order.";
}

async function editBoss(index) {
  const boss = state.bosses[index];
  const status = document.querySelector("#custom-boss-status");
  status.textContent = `Loading ${boss.name}…`;
  try {
    const detail = await api(`/api/bosses/${boss.id}`);
    document.querySelector("#custom-boss-id").value = detail.id;
    document.querySelector("#custom-boss-name").value = detail.name;
    document.querySelector("#custom-boss-export").value = detail.export;
    document.querySelector("#boss-form-heading").textContent = `Edit ${detail.name}`;
    document.querySelector("#save-boss").textContent = "Save boss";
    document.querySelector("#save-boss").disabled = false;
    document.querySelector("#cancel-boss-edit").classList.remove("hidden");
    status.textContent = "Validate and save to apply this edit.";
  } catch (error) {
    status.textContent = error.message;
  }
}

function resetBossForm() {
  document.querySelector("#custom-boss-form").reset();
  document.querySelector("#custom-boss-id").value = "";
  document.querySelector("#boss-form-heading").textContent = "Add or edit boss";
  document.querySelector("#save-boss").textContent = "Add boss";
  document.querySelector("#save-boss").disabled = state.bosses.length >= MAX_BOSSES;
  document.querySelector("#cancel-boss-edit").classList.add("hidden");
}

function renderGauntlet(gauntlet) {
  const list = document.querySelector("#gauntlet-list");
  const button = document.querySelector("#start-gauntlet");
  const summary = document.querySelector("#gauntlet-summary");
  if (!gauntlet || !gauntlet.bosses.length) {
    list.innerHTML = "";
    summary.textContent = "";
    button.textContent = "Start boss rush";
    return;
  }
  summary.textContent = gauntletReport(gauntlet);
  button.textContent = gauntlet.complete ? "Restart boss rush" : "Continue boss rush";
  list.innerHTML = gauntlet.bosses.map((boss, index) => {
    const result = gauntlet.results[index];
    const resultClass = result ? `winner-${result.winner}` : "";
    const status = result
      ? `${result.winner === "tie" ? "Tie" : `${result.winner} win`} · ${result.turns} turns`
      : boss.current
        ? "Running next"
        : boss.complete
          ? "Complete"
          : "Waiting";
    return `
      <li class="${boss.current ? "current" : ""} ${result ? "complete" : ""} ${resultClass}">
        <span>${index + 1}. ${boss.name}</span>
        <small>${status}</small>
      </li>`;
  }).join("");
}

function renderDraft(draft) {
  state.sessionId = draft.session_id;
  state.teamExport = draft.complete ? draft.team_export : "";
  renderTeam(draft.team);
  renderGauntlet(draft.gauntlet);
  renderBattleResults(
    draft.gauntlet?.results?.length
      ? draft.gauntlet.results
      : draft.battle_result
        ? [draft.battle_result]
        : [],
    gauntletReport(draft.gauntlet)
  );
  const status = document.querySelector("#draft-status");
  const offerRoot = document.querySelector("#current-offer");
  const candidates = document.querySelector("#candidate-list");
  const battlePanel = document.querySelector("#battle-panel");

  if (draft.complete) {
    status.innerHTML = `<strong>Draft complete.</strong> Six unique Pokémon assembled at level ${draft.level}.`;
    offerRoot.innerHTML = "";
    candidates.innerHTML = "";
    battlePanel.classList.remove("hidden");
    if (!draft.battle_result && !draft.gauntlet?.results?.length) {
      battlePanel.scrollIntoView({behavior: "smooth", block: "center"});
    }
    return;
  }

  battlePanel.classList.add("hidden");
  document.querySelector("#battle-replay-list").innerHTML = "";
  document.querySelector("#battle-replay-summary").textContent = "";
  document.querySelector("#battle-result-panel").classList.add("hidden");
  status.innerHTML = `<strong>Round ${draft.offer.round_number}/6</strong> · ${draft.offer.candidates.length} offered candidates`;
  const thinReroll = draft.offer.thin_reroll_available
    ? `<button id="thin-reroll" class="thin-reroll-button">Free re-spin (thin cell)</button>`
    : "";
  const totalSkips = draft.draft_config.manual_skip_count;
  offerRoot.innerHTML = `
    <div class="offer-heading">
      <div>
        <p class="eyebrow">Current cell</p>
        <h3>${draft.offer.cell.type} · Gen ${draft.offer.cell.generation}</h3>
        ${draft.offer.thin_reroll_available ? `<p class="thin-note">Fewer than ${draft.offer.thin_cell_threshold} undrafted choices remain; this re-spin is free and not banked.</p>` : ""}
      </div>
      <div class="offer-actions">
        ${thinReroll}
        <button id="skip-draft" class="skip-button" ${draft.skips_remaining ? "" : "disabled"}>
          Manual skip (${draft.skips_remaining}/${totalSkips})
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
      body: JSON.stringify({level: 100}),
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

function battleResultLabel(result) {
  return result.winner === "tie"
    ? "Tie"
    : `${result.winner === "player" ? result.player_name : result.boss_name} wins`;
}

function renderBattleResults(results, summary = "") {
  const panel = document.querySelector("#battle-result-panel");
  const list = document.querySelector("#battle-replay-list");
  const summaryRoot = document.querySelector("#battle-replay-summary");
  if (!results.length) {
    list.innerHTML = "";
    summaryRoot.textContent = "";
    panel.classList.add("hidden");
    return;
  }
  const existingBattleIds = new Set(
    [...list.querySelectorAll("[data-battle-id]")].map(item => item.dataset.battleId)
  );
  results.forEach((result, index) => {
    if (existingBattleIds.has(result.battle_id)) return;
    const card = document.createElement("article");
    card.className = `battle-replay-card winner-${result.winner}`;
    card.dataset.battleId = result.battle_id;
    const iframe = document.createElement("iframe");
    iframe.className = "battle-replay";
    iframe.title = `${result.player_name} vs ${result.boss_name} replay`;
    iframe.srcdoc = replayDocument(result.replay_log);
    card.innerHTML = `
      <div class="battle-replay-heading">
        <div>
          <p class="eyebrow">Battle ${index + 1}</p>
          <h3>${escapeHtml(result.player_name)} vs ${escapeHtml(result.boss_name)}</h3>
          <p>${escapeHtml(battleResultLabel(result))} in ${result.turns} turns</p>
        </div>
        <code>${escapeHtml(result.battle_id)}</code>
      </div>`;
    card.appendChild(iframe);
    list.appendChild(card);
  });
  summaryRoot.textContent = summary;
  panel.classList.remove("hidden");
}

function renderBattleResult(result) {
  renderBattleResults([result]);
  document.querySelector("#battle-status").textContent = "Battle complete.";
}

async function copyTeamExport() {
  const button = document.querySelector("#copy-team-export");
  if (!state.teamExport || !button) return;
  const originalText = button.textContent;
  try {
    await navigator.clipboard.writeText(state.teamExport);
    button.textContent = "Copied";
  } catch (_error) {
    const textArea = document.createElement("textarea");
    textArea.value = state.teamExport;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    textArea.remove();
    button.textContent = "Copied";
  }
  setTimeout(() => {
    button.textContent = originalText;
  }, 1200);
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

function gauntletCompletionStatus(gauntlet) {
  const report = gauntletReport(gauntlet);
  const stoppedOnLoss = gauntlet.stop_on_loss
    && gauntlet.results.length
    && gauntlet.results[gauntlet.results.length - 1].winner !== "player";
  const prefix = stoppedOnLoss
    ? "Real boss rush ended after first loss."
    : "Boss rush complete.";
  return report ? `${prefix} ${report}` : prefix;
}

async function startGauntlet(stopOnLoss = false) {
  const button = document.querySelector("#start-gauntlet");
  const realButton = document.querySelector("#start-real-gauntlet");
  const singleBattleButton = document.querySelector("#battle-boss");
  const status = document.querySelector("#battle-status");
  button.disabled = true;
  realButton.disabled = true;
  singleBattleButton.disabled = true;
  state.gauntletRunning = true;
  if (state.bosses.length < MIN_BOSSES || state.bosses.length > MAX_BOSSES) {
    status.textContent = `Boss rush needs ${MIN_BOSSES}-${MAX_BOSSES} bosses.`;
    button.disabled = false;
    realButton.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
    return;
  }
  status.textContent = stopOnLoss ? "Starting real boss rush…" : "Starting boss rush…";
  try {
    const currentState = await api(`/api/drafts/${state.sessionId}`);
    if (currentState.gauntlet.bosses.length && !currentState.gauntlet.complete) {
      renderDraft(currentState);
    } else {
      status.textContent = "Starting boss order…";
      const draft = await api(`/api/drafts/${state.sessionId}/gauntlet/start`, {
        method: "POST",
        body: JSON.stringify({
          boss_ids: orderedBossIds(),
          stop_on_loss: stopOnLoss,
        }),
      });
      renderDraft(draft);
    }
    setTimeout(runNextGauntletBattle, 0);
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    realButton.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
  }
}

async function runNextGauntletBattle() {
  const status = document.querySelector("#battle-status");
  const button = document.querySelector("#start-gauntlet");
  const realButton = document.querySelector("#start-real-gauntlet");
  const singleBattleButton = document.querySelector("#battle-boss");
  try {
    const currentState = await api(`/api/drafts/${state.sessionId}`);
    if (currentState.gauntlet.complete) {
      renderDraft(currentState);
      status.textContent = gauntletCompletionStatus(currentState.gauntlet);
      button.disabled = false;
      realButton.disabled = false;
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
    const shouldContinue = !nextState.gauntlet.complete;
    if (shouldContinue) {
      setTimeout(() => {
        if (state.gauntletRunning) runNextGauntletBattle();
      }, 500);
    }
    renderDraft(nextState);
    if (shouldContinue) {
      return;
    }
    status.textContent = gauntletCompletionStatus(nextState.gauntlet);
    button.disabled = false;
    realButton.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    realButton.disabled = false;
    singleBattleButton.disabled = false;
    state.gauntletRunning = false;
  }
}

async function addCustomBoss(event) {
  event.preventDefault();
  const status = document.querySelector("#custom-boss-status");
  const bossId = document.querySelector("#custom-boss-id").value;
  const name = document.querySelector("#custom-boss-name").value.trim();
  const exportText = document.querySelector("#custom-boss-export").value.trim();
  if (!name || !exportText) {
    status.textContent = "Boss name and export are required.";
    return;
  }
  if (!bossId && state.bosses.length >= MAX_BOSSES) {
    status.textContent = `A boss rush can include at most ${MAX_BOSSES} bosses.`;
    return;
  }
  status.textContent = bossId ? "Validating edited boss…" : "Validating pasted boss…";
  try {
    const boss = await api(bossId ? `/api/bosses/${bossId}` : "/api/bosses/custom", {
      method: bossId ? "PUT" : "POST",
      body: JSON.stringify({name, export: exportText}),
    });
    const bosses = bossId
      ? state.bosses.map(current => current.id === boss.id ? boss : current)
      : [...state.bosses, boss];
    renderBosses(bosses);
    resetBossForm();
    status.textContent = bossId ? `Saved ${boss.name}.` : `Added ${boss.name}.`;
  } catch (error) {
    status.textContent = `Boss does not pass validation: ${error.message}`;
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
document.querySelector("#start-gauntlet").addEventListener("click", () => startGauntlet(false));
document.querySelector("#start-real-gauntlet").addEventListener("click", () => startGauntlet(true));
document.querySelector("#copy-team-export").addEventListener("click", copyTeamExport);
document.querySelector("#custom-boss-form").addEventListener("submit", addCustomBoss);
document.querySelector("#cancel-boss-edit").addEventListener("click", resetBossForm);
renderTeam([]);
resetBossForm();

api("/api/matrix").then(matrix => {
  state.matrix = matrix;
  renderMatrix();
}).catch(error => {
  document.querySelector("#matrix-summary").textContent = error.message;
});

api("/api/bosses").then(renderBosses).catch(error => {
  document.querySelector("#battle-status").textContent = error.message;
});
