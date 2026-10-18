// The game page: port of v1's web_static/app.js with the FastAPI session
// replaced by GameSession (in-page) and battles run in the Web Worker.
// Screens, markup, and styles are carried over from v1.
import {BattleClient} from '../battle/client.ts';
import {DEFAULT_BUDGET_MS} from '../battle/runner.ts';
import type {GameData} from '../game/data.ts';
import {esc, mountReplay} from '../replay/embed.ts';
import {
  BOSS_ORDER_MAX, BOSS_ORDER_MIN, BossBook, DraftError, GameSession, SessionError, createGameContext, matrixView,
  type BattleResult, type BossInfo, type GameContext, type GauntletView, type MatrixCellView, type MatrixView, type OfferView,
  type SessionView, type SpeciesView,
} from './session.ts';
import {initRoller, rollMon} from './roller.js';

/* =====================================================================
   STATE
   ===================================================================== */
interface State {
  ctx: GameContext | null;
  bossBook: BossBook | null;
  session: GameSession | null;
  view: SessionView | null;
  bosses: BossInfo[];
  teamExport: string;
  gauntletRunning: boolean;
  matrix: MatrixView | null;
}
const state: State = {ctx: null, bossBook: null, session: null, view: null, bosses: [], teamExport: '', gauntletRunning: false, matrix: null};

const params = new URLSearchParams(location.search);
// Dev knobs: ?seed=N makes the run reproducible; ?p1ms=&p2ms= set the search
// budgets and override the player's low-power switch (docs/ROADMAP.md §2).
const LOW_POWER_KEY = 'rollmons-low-power';
let lowPower = false;
try { lowPower = localStorage.getItem(LOW_POWER_KEY) === '1'; } catch { /* private mode */ }
function setLowPower(on: boolean): void {
  lowPower = on;
  try { localStorage.setItem(LOW_POWER_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}
/** Search budget for the next battle: halved in low-power mode, unless the dev knobs are set. */
function budgetMs(): {p1: number; p2: number} {
  const scale = lowPower ? 0.5 : 1;
  return {p1: Number(params.get('p1ms')) || Math.round(DEFAULT_BUDGET_MS.p1 * scale), p2: Number(params.get('p2ms')) || Math.round(DEFAULT_BUDGET_MS.p2 * scale)};
}
const battles = new BattleClient(new Worker(new URL('./worker.js', import.meta.url), {type: 'module'}));

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Request failed';

/* =====================================================================
   ROUTER
   ===================================================================== */
const SCREENS = ['title', 'draft', 'loadout', 'bosses', 'battle', 'results', 'pool'] as const;
type Screen = typeof SCREENS[number];
let currentScreen: Screen = 'title';
let poolReturn: Screen = 'title';
function go(name: Screen): void {
  if (name === 'pool' && currentScreen !== 'pool') poolReturn = currentScreen;
  currentScreen = name;
  SCREENS.forEach((s) => $('screen-' + s).classList.toggle('active', s === name));
  $('topbar').classList.toggle('hidden', name === 'title');
  if (name === 'loadout') renderLoadout();
  // On the pool screen keep the step rail reflecting where Back will return to.
  updateSteps(name === 'pool' ? poolReturn : name);
  $('pokedex-btn').textContent = name === 'pool' ? '← Back' : 'Pokédex';
  try { localStorage.setItem('rollmons-screen', name); } catch { /* private mode */ }
  window.scrollTo(0, 0);
}
function togglePool(): void { go(currentScreen === 'pool' ? (poolReturn || 'title') : 'pool'); }
// Topbar steps are progress indicators only — navigation is via the in-screen
// buttons, so the player can't jump back mid-run to restart the fight.
function jumpToReplay(bid: string): void {
  go('battle');
  setTimeout(() => { document.querySelector(`#theater [data-bid="${bid}"]`)?.scrollIntoView({behavior: 'smooth', block: 'start'}); }, 60);
}
function updateSteps(name: string): void {
  const order: Record<string, number> = {draft: 0, loadout: 1, bosses: 2, battle: 3, results: 4};
  const cur = order[name];
  document.querySelectorAll<HTMLElement>('#steps .step').forEach((el) => {
    const i = order[el.dataset.step!];
    el.classList.toggle('active', el.dataset.step === name);
    el.classList.toggle('done', cur !== undefined && i < cur);
  });
}

/* =====================================================================
   HELPERS
   ===================================================================== */
function titleCase(v: unknown): string { return String(v).replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }
function typeChips(p: {types: string[]; legendary?: boolean}): string {
  const t = p.types.map((x) => `<span class="chip t-${x.toLowerCase()}">${titleCase(x)}</span>`).join('');
  return t + (p.legendary ? '<span class="chip legend">Legendary</span>' : '');
}
const TYPE_COLORS: Record<string, string> = {
  bug: '#92bc2c', dark: '#595761', dragon: '#0c69c8', electric: '#eab911', fairy: '#ee90e6', fighting: '#d3425f', fire: '#fba54c',
  flying: '#7ab9e0', ghost: '#5f6dbc', grass: '#5fbd58', ground: '#da7c4d', ice: '#75d0c1', normal: '#a0a29f', poison: '#b763cf',
  psychic: '#fa8581', rock: '#c9bb8a', steel: '#5695a3', water: '#539ddf',
};
function typeColor(t: string): string { return TYPE_COLORS[String(t).toLowerCase()] || 'var(--ink)'; }
function fixImages(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('.asset').forEach((img) => {
    const hide = () => { img.closest('.asset-host')?.classList.add('asset-failed'); img.remove(); };
    img.addEventListener('error', hide, {once: true});
    if (img.complete && img.naturalWidth === 0) hide();
  });
}
function sprite(p: {spriteUrl?: string}, cls = ''): string {
  return `<span class="asset-host ${cls}"><img class="asset" src="${p.spriteUrl || ''}" alt="" loading="lazy"></span>`;
}

/* =====================================================================
   DRAFT
   ===================================================================== */
function refreshView(): SessionView {
  state.view = state.session!.view();
  return state.view;
}
function renderDraft(draft: SessionView): void {
  $('draft-status').textContent = '';
  state.teamExport = draft.complete ? (draft.teamExport || '') : '';
  $<HTMLButtonElement>('copy-export').disabled = !state.teamExport;

  renderPips(draft);
  renderParty(draft.team, 'party');
  $('party-count').textContent = `${draft.team.length} / 6 drafted`;

  const live = $('draft-live');
  const done = $('draft-done');
  if (draft.complete) {
    live.classList.add('hidden'); done.classList.remove('hidden');
    renderParty(draft.team, 'party-done');
    return;
  }
  live.classList.remove('hidden'); done.classList.add('hidden');
  renderEncounter(draft);
  renderCandidates(draft.offer!);
}
function renderPips(draft: SessionView): void {
  const filled = draft.team.length;
  $('pips').innerHTML = Array.from({length: 6}, (_, i) => {
    const cls = i < filled ? 'filled' : (i === filled && !draft.complete ? 'current' : '');
    return `<span class="pip ${cls}"></span>`;
  }).join('');
  $('round-label').textContent = draft.complete ? 'Complete' : `Round ${draft.offer!.roundNumber} of 6`;
}
function renderEncounter(draft: SessionView): void {
  const o = draft.offer!;
  const totalSkips = draft.draftConfig.manualSkipCount;
  const thin = o.thinRerollAvailable ? '<button class="btn btn-warn btn-sm" onclick="thinReroll()">↻ Free re-spin</button>' : '';
  $('encounter').innerHTML = `
    <div>
      <p class="eyebrow" style="margin:0 0 .25rem">Wild cell</p>
      <div class="cell-name"><span style="color:${typeColor(o.cell.type)}">${titleCase(o.cell.type)}</span> · Gen ${o.cell.generation}</div>
      ${o.thinRerollAvailable ? `<p class="thin-note">Thin cell — fewer than ${o.thinCellThreshold} choices left, this re-spin is free.</p>` : ''}
    </div>
    <div class="encounter-actions">
      ${thin}
      <button class="btn btn-ghost btn-sm" onclick="skip()" ${draft.skipsRemaining ? '' : 'disabled'}>
        Skip cell (${draft.skipsRemaining}/${totalSkips})
      </button>
    </div>`;
}
// Full PokéPaste text. Smogon/override sets ship an export; randbats sets
// don't, so build one from the parsed fields + the neutral assembly spread.
interface PasteSet { export?: string | null; item?: string; ability?: string; moves?: string[] }
function pokepaste(name: string, set: PasteSet | null, spread: SpeciesView['assemblySpread'] | null): string {
  if (set && set.export) return set.export;
  const lines = [`${titleCase(name)}${set && set.item ? ` @ ${titleCase(set.item)}` : ''}`];
  if (set && set.ability) lines.push(`Ability: ${titleCase(set.ability)}`);
  if (spread) {
    lines.push(`Level: ${spread.level}`);
    const ev = Object.entries(spread.evs).map(([k, v]) => `${v} ${k}`).join(' / ');
    if (ev) lines.push(`EVs: ${ev}`);
    if (spread.nature) lines.push(`${spread.nature} Nature`);
  }
  (set?.moves ?? []).forEach((m) => lines.push(`- ${titleCase(m)}`));
  return lines.join('\n');
}
function setSummary(p: SpeciesView): string {
  return `<div class="setbox"><pre class="pokepaste-set">${esc(pokepaste(p.name, p.set, p.assemblySpread))}</pre></div>`;
}
function renderCandidates(offer: OfferView): void {
  const root = $('candidates');
  root.innerHTML = offer.candidates.map((p) => {
    const prob = p.selectionProbability * 100;
    return `
    <article class="mon">
      <div class="mon-top">
        <span class="mon-badge">Gen ${p.debutGeneration} · BST ${p.baseStatTotal}</span>
        <div class="sprite-frame">${sprite(p)}</div>
        <div class="mon-name">${titleCase(p.name)}</div>
        <div class="chips">${typeChips(p)}</div>
      </div>
      <div class="mon-body">
        <div class="prob" title="Draft odds">
          <span>Odds</span>
          <span class="bar"><i style="width:${Math.min(100, prob)}%"></i></span>
          <span class="mono">${prob.toFixed(1)}%</span>
        </div>
        ${setSummary(p)}
      </div>
      <button class="btn btn-primary pick" onclick="pick('${p.id}')">Pick ${titleCase(p.name)}</button>
    </article>`;
  }).join('');
  fixImages(root);
}
function renderParty(team: SpeciesView[], targetId: string): void {
  const root = $(targetId);
  const slots: (SpeciesView | null)[] = [...team];
  while (slots.length < 6) slots.push(null);
  root.innerHTML = slots.map((p, i) => p
    ? `<li class="slot"><span class="mini">${sprite(p)}</span>
         <span class="info"><strong>${titleCase(p.name)}</strong>
         <span>Gen ${p.debutGeneration} · BST ${p.baseStatTotal}</span></span></li>`
    : `<li class="slot empty"><span class="pokeball ball"></span><span class="info"><strong>Slot ${i + 1}</strong><span>Empty</span></span></li>`,
  ).join('');
  fixImages(root);
}

function newRun(): void {
  go('draft');
  $('encounter').innerHTML = '<div><p class="lead">Rolling the first cell…</p></div>';
  try {
    if (!state.ctx) throw new Error('game data is still loading');
    const seed = params.get('seed') ? Number(params.get('seed')) : undefined;
    state.session = new GameSession(state.ctx, {seed, bosses: state.bossBook!});
    state.gauntletRunning = false;
    $('theater').innerHTML = '';
    renderDraft(refreshView());
  } catch (e) { $('encounter').innerHTML = `<div><p class="lead">${esc(errorMessage(e))}</p></div>`; }
}
function draftAction(action: () => void): void {
  try { action(); renderDraft(refreshView()); } catch (e) {
    if (e instanceof DraftError || e instanceof SessionError) $('draft-status').textContent = e.message;
    else throw e;
  }
}
function pick(id: string): void { draftAction(() => state.session!.pick(id)); }
function skip(): void { draftAction(() => state.session!.skip()); }
function thinReroll(): void { draftAction(() => state.session!.thinReroll()); }

async function copyExport(): Promise<void> {
  if (!state.teamExport) return;
  try {
    await navigator.clipboard.writeText(state.teamExport);
    document.querySelectorAll<HTMLButtonElement>('#copy-export').forEach((b) => { const t = b.textContent; b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = t; }, 1200); });
  } catch { /* clipboard unavailable */ }
}

/* =====================================================================
   LOADOUT  (choose one set per drafted Pokémon; Mega is opt-in)
   ===================================================================== */
function renderLoadout(): void {
  const draft = state.view;
  const list = $('loadout-list');
  if (!draft || !draft.loadout) { list.innerHTML = ''; return; }
  list.innerHTML = draft.loadout.map((entry) => {
    const chosen = entry.sets.find((s) => s.setId === entry.chosenSetId) || entry.sets[0];
    const opts = entry.sets.map((s) =>
      `<option value="${s.setId}"${s.setId === chosen.setId ? ' selected' : ''}>${esc(s.label)}${s.isMega ? ' ⚡ Mega' : ''}</option>`,
    ).join('');
    const picker = (entry.sets.length > 1 && !entry.locked)
      ? `<select class="set-select" onchange="chooseSet('${entry.speciesId}',this.value)">${opts}</select>`
      : `<span class="set-only">${esc(chosen.label)}${chosen.isMega ? ' ⚡ Mega' : ''}</span>`;
    return `
      <article class="loadout-card card">
        <div class="loadout-head"><span class="mini">${sprite(entry)}</span><strong>${titleCase(entry.name)}</strong></div>
        <label class="field set-field">Set ${picker}</label>
        <div class="setbox"><pre class="pokepaste-set">${esc(pokepaste(entry.name, chosen, null))}</pre></div>
      </article>`;
  }).join('');
  fixImages(list);
}
function chooseSet(speciesId: string, setId: string): void {
  const status = $('loadout-status');
  try {
    state.session!.chooseSet(speciesId, setId);
    const view = refreshView();
    state.teamExport = view.teamExport || '';
    renderLoadout();
    status.textContent = '';
  } catch (e) { status.textContent = errorMessage(e); }
}

/* =====================================================================
   BOSSES
   ===================================================================== */
function bossName(b: BossInfo): string { return b.source === 'custom' ? `${b.name} (pasted)` : b.source === 'edited' ? `${b.name} (edited)` : b.name; }
function renderBosses(bosses: BossInfo[]): void {
  state.bosses = bosses;
  const ladder = $('ladder');
  ladder.innerHTML = bosses.map((b, i) => `
    <li class="boss" draggable="true" data-index="${i}">
      <span class="handle" aria-hidden="true">⠿</span>
      <span class="num">${i + 1}</span>
      <span class="bname">${esc(b.name)}</span>
      ${b.source === 'custom' || b.source === 'edited' ? `<span class="tag">${b.source}</span>` : ''}
      <span class="acts">
        <button class="btn btn-ghost btn-sm" onclick="editBoss(${i})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="discardBoss(${i})" ${bosses.length <= BOSS_ORDER_MIN ? 'disabled' : ''}>✕</button>
      </span>
    </li>`).join('');
  wireDrag(ladder);
  const sel = $<HTMLSelectElement>('boss-select');
  sel.replaceChildren(...bosses.map((b) => { const o = document.createElement('option'); o.value = b.id; o.textContent = bossName(b); return o; }));
  $<HTMLButtonElement>('run-btn').disabled = bosses.length === 0;
  $<HTMLButtonElement>('exhibition-btn').disabled = bosses.length === 0;
  if (bosses.length === 0) $('boss-status').textContent = 'No bosses found under rollmons/bosses/.';
}
function wireDrag(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('.boss').forEach((item) => {
    item.addEventListener('dragstart', (e) => { e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', item.dataset.index!); item.classList.add('dragging'); });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault(); root.querySelectorAll('.drag-over').forEach((r) => r.classList.remove('drag-over'));
      moveBoss(Number(e.dataTransfer!.getData('text/plain')), Number(item.dataset.index));
    });
  });
}
function moveBoss(from: number, to: number): void {
  if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;
  const b = [...state.bosses]; const [m] = b.splice(from, 1); b.splice(to, 0, m); renderBosses(b);
}
function discardBoss(i: number): void {
  if (state.bosses.length <= BOSS_ORDER_MIN) { $('boss-form-status').textContent = 'At least one boss must remain.'; return; }
  renderBosses(state.bosses.filter((_, j) => j !== i)); resetBossForm();
}
function editBoss(i: number): void {
  const b = state.bosses[i]; const st = $('boss-form-status');
  try {
    const d = state.bossBook!.info(b.id);
    $<HTMLInputElement>('boss-id').value = d.id;
    $<HTMLInputElement>('boss-name').value = d.name;
    $<HTMLTextAreaElement>('boss-export').value = d.export;
    $('boss-form-title').textContent = `Edit ${d.name}`;
    $('boss-save').textContent = 'Save boss';
    $('boss-cancel').classList.remove('hidden');
    st.textContent = 'Validate and save to apply.';
  } catch (e) { st.textContent = errorMessage(e); }
}
function resetBossForm(): void {
  $<HTMLFormElement>('boss-form').reset();
  $<HTMLInputElement>('boss-id').value = '';
  $('boss-form-title').textContent = 'Add a boss';
  $('boss-save').textContent = 'Add boss';
  $('boss-cancel').classList.add('hidden');
}
function saveBoss(e: Event): void {
  e.preventDefault();
  const st = $('boss-form-status');
  const id = $<HTMLInputElement>('boss-id').value;
  const name = $<HTMLInputElement>('boss-name').value.trim();
  const exp = $<HTMLTextAreaElement>('boss-export').value.trim();
  if (!name || !exp) { st.textContent = 'Name and export are required.'; return; }
  if (!id && state.bosses.length >= BOSS_ORDER_MAX) { st.textContent = `A run can hold at most ${BOSS_ORDER_MAX} bosses.`; return; }
  st.textContent = 'Validating…';
  try {
    const boss = id ? state.bossBook!.edit(id, name, exp) : state.bossBook!.addCustom(name, exp);
    renderBosses(id ? state.bosses.map((b) => (b.id === boss.id ? boss : b)) : [...state.bosses, boss]);
    resetBossForm(); st.textContent = id ? `Saved ${boss.name}.` : `Added ${boss.name}.`;
  } catch (err) { st.textContent = `Does not validate: ${errorMessage(err)}`; }
}

/* =====================================================================
   RUN / BATTLE  (Showdown replay viewport untouched)
   ===================================================================== */
function renderRail(gauntlet: GauntletView): void {
  const rail = $('rail');
  if (!gauntlet.bosses.length) { rail.innerHTML = ''; return; }
  rail.innerHTML = gauntlet.bosses.map((b, i) => {
    const r = gauntlet.results[i];
    let cls = '', label = 'Waiting';
    if (r) { cls = r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie'; label = `${r.turns}t`; }
    else if (b.current) { cls = 'current'; label = 'Now'; }
    // A finished battle's rail entry scrolls its replay card into view.
    const attrs = r ? ` class="${cls} clickable" onclick="jumpToReplay('${r.battleId}')" title="Watch this battle" role="button" tabindex="0"` : ` class="${cls}"`;
    return `<li${attrs}><span class="dot"></span><span>${i + 1}. ${esc(b.name)}</span><small>${label}</small></li>`;
  }).join('');
}
function renderTheater(results: BattleResult[]): void {
  const theater = $('theater');
  if (!results.length) {
    theater.innerHTML = '<div class="replay-card replay-placeholder"><div class="replay-ph"><div><div class="big">Waiting for the first battle…</div><div class="sm">Matchups stream in here as your team climbs the ladder.</div></div></div></div>';
    return;
  }
  // The first real battle replaces the waiting placeholder.
  theater.querySelector('.replay-placeholder')?.remove();
  const seen = new Set(Array.from(theater.querySelectorAll<HTMLElement>('[data-bid]'), (n) => n.dataset.bid));
  results.forEach((r) => {
    if (seen.has(r.battleId)) return;
    const cls = r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie';
    const resLabel = r.winner === 'tie' ? 'Tie' : `${r.winner === 'player' ? r.playerName : r.bossName} wins`;
    const card = document.createElement('div');
    card.className = 'replay-card'; card.dataset.bid = r.battleId;
    card.innerHTML = `
      <div class="replay-head">
        <h3>${esc(r.playerName)} <span style="color:var(--faint)">vs</span> ${esc(r.bossName)}</h3>
        <span class="res ${cls}">${esc(resLabel)} · ${r.turns}t</span>
      </div>`;
    if (r.log.length) {
      // The srcdoc is deferred until the card is visible: the Showdown player
      // measures its container on init (see replay/embed.ts).
      mountReplay(card, r.log, r.bossName, r.playerName);
    } else {
      const ph = document.createElement('div'); ph.className = 'replay-ph';
      ph.innerHTML = `<div><div class="big">No replay for this battle</div><div class="sm">${esc(resLabel)} in ${r.turns} turns.</div></div>`;
      card.appendChild(ph);
    }
    theater.appendChild(card);
  });
}
function renderRun(draft: SessionView): void {
  const g = draft.gauntlet;
  renderRail(g);
  const results = g.results.length ? g.results : (draft.battleResult ? [draft.battleResult] : []);
  if (results.length === 0) $('theater').innerHTML = '';
  renderTheater(results);
  if (!g.complete && g.bosses.length) {
    const nb = g.bosses[g.nextIndex];
    if (nb) $('battle-lead').textContent = `Now battling ${nb.name} — ${g.nextIndex + 1} of ${g.bosses.length}.`;
  }
  $<HTMLButtonElement>('to-results').disabled = !g.complete;
}

function orderedBossIds(): string[] { return state.bosses.map((b) => b.id); }

function requireSession(): GameSession | null {
  if (!state.session) { $('boss-status').textContent = 'Draft a team first.'; return null; }
  return state.session;
}

function startRun(stopOnLoss: boolean): void {
  const session = requireSession();
  if (!session) return;
  if (state.bosses.length < BOSS_ORDER_MIN) { $('boss-status').textContent = 'Add at least one boss first.'; return; }
  go('battle');
  $('battle-lead').textContent = stopOnLoss ? 'Climbing the ladder — one loss ends the run.' : 'Exhibition — playing every boss.';
  $('theater').innerHTML = '';
  state.gauntletRunning = true;
  try {
    session.startGauntlet(orderedBossIds(), stopOnLoss);
    renderRun(refreshView());
    setTimeout(runNext, 0);
  } catch (e) { $('battle-lead').textContent = errorMessage(e); state.gauntletRunning = false; }
}
function startCampaign(stopOnLoss: boolean): void {
  const session = requireSession();
  if (!session) return;
  go('battle');
  $('battle-lead').textContent = 'Tiered campaign — 10 battles, one random team drawn per level.';
  $('theater').innerHTML = '';
  state.gauntletRunning = true;
  try {
    session.startCampaign(stopOnLoss);
    renderRun(refreshView());
    setTimeout(runNext, 0);
  } catch (e) { $('battle-lead').textContent = errorMessage(e); state.gauntletRunning = false; }
}
async function runNext(): Promise<void> {
  const session = state.session!;
  try {
    const spec = session.nextBattleSpec();
    if (!spec) { finishRun(); return; }
    renderRail(session.gauntletView());
    const outcome = await battles.run({
      p1: {name: 'Player', team: spec.playerTeam}, p2: {name: spec.bossName, team: spec.bossTeam}, seed: spec.seed, budgetMs: budgetMs(),
      onTurn: (e) => { if (state.session === session) $('battle-lead').textContent = `Now battling ${spec.bossName} — turn ${e.turn}.`; },
    });
    if (state.session !== session) return; // a new run started meanwhile
    session.recordGauntletBattle(spec, outcome);
    renderRun(refreshView());
    if (!session.gauntletComplete) { if (state.gauntletRunning) setTimeout(runNext, 650); }
    else finishRun();
  } catch (e) { $('battle-lead').textContent = errorMessage(e); state.gauntletRunning = false; }
}
function finishRun(): void {
  state.gauntletRunning = false;
  const view = refreshView();
  renderRun(view);
  $<HTMLButtonElement>('to-results').disabled = false;
  renderResults(view.gauntlet);
  setTimeout(() => go('results'), 500);
}

async function battleOne(): Promise<void> {
  const session = requireSession();
  if (!session) return;
  const id = $<HTMLSelectElement>('boss-select').value;
  if (!id) { $('boss-status').textContent = 'Pick a boss to test.'; return; }
  go('battle');
  $('battle-lead').textContent = 'Single exhibition battle.';
  $('theater').innerHTML = '';
  try {
    const spec = session.singleBattleSpec(id);
    const outcome = await battles.run({p1: {name: 'Player', team: spec.playerTeam}, p2: {name: spec.bossName, team: spec.bossTeam}, seed: spec.seed, budgetMs: budgetMs()});
    if (state.session !== session) return;
    session.recordSingleBattle(spec, outcome);
    renderRun(refreshView());
  } catch (e) { $('battle-lead').textContent = errorMessage(e); }
}

/* =====================================================================
   RESULTS
   ===================================================================== */
function renderResults(g: GauntletView): void {
  const results = g.results, total = g.bosses.length;
  const wins = results.filter((r) => r.winner === 'player').length;
  const losses = results.filter((r) => r.winner === 'boss').length;
  const ties = results.filter((r) => r.winner === 'tie').length;
  const avg = results.length ? results.reduce((s, r) => s + r.turns, 0) / results.length : 0;
  const cleared = wins === total;
  const lastLoss = g.stopOnLoss && results.length > 0 && results[results.length - 1].winner !== 'player';

  const hero = $('result-hero');
  hero.className = 'result-hero ' + (cleared ? 'victory' : lastLoss ? 'defeat' : 'mixed');
  $('result-eyebrow').textContent = `${total}-battle campaign`;
  $('result-title').textContent = cleared ? 'Champion! 🏆' : lastLoss ? 'Run ended' : 'Gauntlet complete';
  $('result-record').textContent = `${wins}–${losses}${ties ? `–${ties}` : ''}  ·  cleared ${wins}/${total}  ·  ${avg.toFixed(1)} avg turns`;

  // the climb, as one pip per battle slot in run order
  $('result-pips').innerHTML = g.bosses.map((b, i) => {
    const r = results[i];
    const cls = !r ? 'pending' : r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie';
    return `<span class="rpip ${cls}" title="${esc(b.name)}${r ? ` · ${r.winner} · ${r.turns}t` : ''}"></span>`;
  }).join('');

  // sprite lookup from the drafted team (damage names are lowercase species names)
  const team = state.view?.team ?? [];
  const spriteByName: Record<string, string> = {};
  team.forEach((p) => { spriteByName[String(p.name).toLowerCase()] = p.spriteUrl; });
  const dmg = g.damage;
  const mvpName = dmg.mvp?.name;
  const maxShare = Math.max(1, ...dmg.byPokemon.map((e) => e.contribution));

  $('damage-bars').innerHTML = dmg.byPokemon.length
    ? dmg.byPokemon.map((e) => {
        const sp = spriteByName[String(e.name).toLowerCase()];
        const isMvp = e.name === mvpName && e.contribution > 0;
        const w = Math.max(3, (e.contribution / maxShare) * 100);
        return `<div class="dmg-row${isMvp ? ' mvp' : ''}">
          <span class="dmg-mon">${sp ? sprite({spriteUrl: sp}, 'mini') : '<span class="asset-host mini"></span>'}<span class="dmg-name">${titleCase(e.name)}${isMvp ? '<span class="mvp-tag">MVP</span>' : ''}</span></span>
          <span class="dmg-track"><i style="width:${w}%"></i></span>
          <span class="dmg-num"><b>${e.contribution.toFixed(1)}%</b><small>${e.damage.toFixed(0)}% dealt</small></span>
        </div>`;
      }).join('')
    : '<p class="panel-note" style="padding:.5rem">No damage was recorded this run.</p>';
  fixImages($('damage-bars'));

  const mvpEl = $('mvp-card');
  if (dmg.mvp) {
    const sp = spriteByName[String(dmg.mvp.name).toLowerCase()];
    mvpEl.classList.remove('hidden');
    mvpEl.innerHTML = `<p class="eyebrow">Run MVP</p>
      <div class="mvp-body">
        ${sp ? sprite({spriteUrl: sp}, 'mvp-sprite') : ''}
        <div class="mvp-meta">
          <strong>${titleCase(dmg.mvp.name)}</strong>
          <p class="mvp-share">${dmg.mvp.contribution.toFixed(1)}%</p>
          <p class="panel-note">of team damage · ${dmg.mvp.damage.toFixed(0)}% HP dealt</p>
        </div>
      </div>`;
    fixImages(mvpEl);
  } else { mvpEl.classList.add('hidden'); }

  $('stat-tiles').innerHTML = `
    <div class="stat win"><div class="v">${wins}</div><div class="k">Wins</div></div>
    <div class="stat loss"><div class="v">${losses}</div><div class="k">Losses</div></div>
    ${ties ? `<div class="stat"><div class="v">${ties}</div><div class="k">Ties</div></div>` : ''}
    <div class="stat"><div class="v">${avg.toFixed(1)}</div><div class="k">Avg turns</div></div>`;

  $('ladder-results').innerHTML = g.bosses.map((b, i) => {
    const r = results[i];
    const cls = !r ? 'pending' : r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie';
    const label = !r ? 'Not reached' : r.winner === 'tie' ? 'Tie' : r.winner === 'player' ? 'Win' : 'Loss';
    const attrs = r ? `onclick="jumpToReplay('${r.battleId}')" title="Watch this battle" role="button" tabindex="0"` : '';
    return `<li class="ladder-row ${cls}${r ? ' clickable' : ''}" ${attrs}><span class="ln">${i + 1}</span><span class="lname">${esc(b.name)}</span><span class="lres">${label}${r ? ` · ${r.turns}t` : ''}</span></li>`;
  }).join('');
}

/* =====================================================================
   POOL / POKÉDEX MATRIX
   ===================================================================== */
function renderMatrix(): void {
  const m = state.matrix!; const grid = $('matrix');
  grid.innerHTML = '<div class="mhead">Type</div>' + m.generations.map((g) => `<div class="mhead">G${g}</div>`).join('');
  for (const type of m.types) {
    grid.insertAdjacentHTML('beforeend', `<div class="mhead type t-${type.toLowerCase()}">${titleCase(type)}</div>`);
    for (const gen of m.generations) {
      const cell = m.cells.find((c) => c.type === type && c.generation === gen)!;
      const btn = document.createElement('button');
      btn.className = `mcell ${cell.state}`;
      btn.innerHTML = `${cell.eligibleCount}<small>${cell.state === 'normal' ? '' : cell.state}</small>`;
      btn.onclick = () => renderCell(cell, btn);
      grid.appendChild(btn);
    }
  }
  $('matrix-summary').textContent = `${m.includedCellCount} included cells · ${m.atomCount} draftable Pokémon`;
}
function renderCell(cell: MatrixCellView, btn: HTMLElement): void {
  document.querySelectorAll('.mcell').forEach((c) => c.classList.remove('selected'));
  btn.classList.add('selected');
  const d = $('detail');
  const list = cell.pokemon.length
    ? `<ul class="dlist">${cell.pokemon.map((p) => `<li><span class="mini">${sprite(p)}</span>
         <span><strong>${titleCase(p.name)}</strong><div class="meta">Gen ${p.debutGeneration} · BST ${p.baseStatTotal}</div>
         <div class="chips" style="justify-content:flex-start;margin-top:.2rem">${typeChips(p)}</div></span></li>`).join('')}</ul>`
    : '<p style="color:var(--muted)">No active-source Pokémon occupy this cell.</p>';
  d.innerHTML = `<h3>${titleCase(cell.type)} · Gen ${cell.generation}</h3>
    <p style="color:var(--muted);font-size:.88rem"><b style="color:var(--ink)">${cell.eligibleCount}</b> eligible · ${
      cell.state === 'excluded' ? 'excluded from rolls' : cell.state === 'thin' ? 'thin — free reroll' : 'included'}</p>${list}`;
  fixImages(d);
}

/* =====================================================================
   BOOT
   ===================================================================== */
// The markup uses inline onclick handlers (carried over from v1), so the
// handlers it names are published on window.
Object.assign(window, {go, togglePool, jumpToReplay, newRun, pick, skip, thinReroll, copyExport, chooseSet, editBoss, discardBoss, resetBossForm, startRun, startCampaign, battleOne, rollMon, setLowPower});
declare global { interface Window { __rollmons: {view: () => SessionView | null; screen: () => string; ready: Promise<string>} } }

$('boss-form').addEventListener('submit', saveBoss);

async function boot(): Promise<void> {
  go('title');
  initRoller();
  $<HTMLInputElement>('low-power').checked = lowPower;
  $('title-foot').textContent = 'Loading game data…';
  try {
    const res = await fetch(new URL('./data/game-data.json', import.meta.url));
    if (!res.ok) throw new Error(`game data: HTTP ${res.status}`);
    const data = (await res.json()) as GameData;
    state.ctx = createGameContext(data);
    state.bossBook = new BossBook(state.ctx);
    state.matrix = matrixView(state.ctx);
    renderMatrix();
    renderBosses(state.bossBook.list());
    $('title-foot').textContent = 'Lv 100 · Gen 9 · engine-enforced dedupe';
  } catch (e) {
    $('matrix-summary').textContent = errorMessage(e);
    $('title-foot').textContent = `Could not load game data: ${errorMessage(e)}`;
  }
}

window.__rollmons = {view: () => state.view, screen: () => currentScreen, ready: battles.ready()};
boot();
