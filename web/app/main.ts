// The game page: port of v1's web_static/app.js with the FastAPI session
// replaced by GameSession (in-page) and battles run in the Web Worker.
// Screens, markup, and styles are carried over from v1.
import {BattleClient} from '../battle/client.ts';
import {DEFAULT_BUDGET_MS} from '../battle/runner.ts';
import type {GameData} from '../game/data.ts';
import {esc, mountLiveReplay, mountReplay, type LiveReplay} from '../replay/embed.ts';
import {
  BOSS_ORDER_MAX, BOSS_ORDER_MIN, BossBook, DraftError, GameSession, PLAYER_NAME, SessionError, createGameContext, matrixView, poolSpecies,
  type BattleResult, type BattleSpec, type BossInfo, type GameContext, type GauntletView, type MatrixView, type OfferView,
  type SessionView, type SpeciesView,
} from './session.ts';
import {RARITY_NAMES} from '../game/legality-matrix.ts';
import {initRoller, rollMon, setRollerPool} from './roller.ts';
import {applyStatic, initLang, localSpeciesName, setLang, t, type Lang} from './i18n.ts';

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
  pool: SpeciesView[] | null;
}
const state: State = {ctx: null, bossBook: null, session: null, view: null, bosses: [], teamExport: '', gauntletRunning: false, matrix: null, pool: null};

const params = new URLSearchParams(location.search);
// Dev knobs: ?seed=N makes the run reproducible; ?p1ms=&p2ms= set the search
// budgets and override the player's low-power switch (docs/ROADMAP.md §2).
/* Leaderboard API (docs/ROADMAP.md §7): the Vercel function on the same
   origin. A local build reads the board from the deployment cross-origin
   (?api=<origin> overrides) but cannot sign in: the session cookie is
   same-origin only, so accounts are enabled only on the hosted site. */
// ?gate=0 lets the next battle start before the previous replay has been watched (scripts only).
const GATE = params.get('gate') !== '0';
const API_BASE = params.get('api') ?? (/\.vercel\.app$/.test(location.hostname) ? '' : 'https://rollmon.vercel.app');
const AUTH_ENABLED = API_BASE === '';
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

/* Language switch (docs/ROADMAP.md §9): UI strings via t(), species names
   from data/species-names.json; replays and set exports stay English. */
function setLanguage(l: string): void {
  setLang(l as Lang);
  applyStatic(document);
  rerenderAll();
}
function rerenderAll(): void {
  $('pokedex-btn').textContent = currentScreen === 'pool' ? t('← Back') : t('Pokédex');
  initRoller(typeName);
  feedRoller();
  renderPool();
  renderBoard();
  renderAccount();
  if (state.bossBook) renderBosses(state.bosses);
  const view = state.view;
  if (!view) return;
  renderDraft(view);
  renderLoadout();
  if (view.gauntlet.bosses.length || view.battleResult) renderRun(view);
  if (view.gauntlet.complete) renderResults(view.gauntlet);
}

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
  // The tools strip has one instance: in the topbar, or in the fixed corner on the title screen.
  if (name === 'title') $('corner').append($('tools')); else $('topbar').insertBefore($('tools'), $('pokedex-btn'));
  $('corner').classList.toggle('hidden', name !== 'title');
  if (!$('board-drawer').classList.contains('hidden')) toggleBoard();
  if (name === 'loadout') renderLoadout();
  // On the pool screen keep the step rail reflecting where Back will return to.
  updateSteps(name === 'pool' ? poolReturn : name);
  $('pokedex-btn').textContent = name === 'pool' ? t('← Back') : t('Pokédex');
  updateSummaryAccess();
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
/** Species display name in the current language (English title case as the fallback). */
function monName(p: {id?: string; name: unknown}): string {
  const id = String(p.id ?? p.name).toLowerCase().replace(/[^a-z0-9]/g, '');
  return localSpeciesName(titleCase(p.name), state.ctx?.data.pokedex[id], state.ctx?.data.speciesNames);
}
const typeName = (x: string) => t(titleCase(x));
function typeChips(p: {types: string[]; legendary?: boolean; visitor?: boolean; debutGeneration?: number}): string {
  const chips = p.types.map((x) => `<span class="chip t-${x.toLowerCase()}">${typeName(x)}</span>`).join('');
  return chips + (p.visitor ? `<span class="chip visitor">${t('Visitor · Gen {n}', {n: p.debutGeneration ?? '?'})}</span>` : '');
}
/** The four ranks wear Poké Ball names on the page (gatcha-style rarity every Pokémon player can read). */
const RARITY_LABELS: Record<string, string> = {common: 'Poké Ball', uncommon: 'Great Ball', rare: 'Ultra Ball', legendary: 'Master Ball'};
/** "★★★☆ Ultra Ball" row; the tier is shown when Showdown has one. */
function rarityRow(p: SpeciesView): string {
  const stars = '★'.repeat(p.rarity + 1) + '☆'.repeat(3 - p.rarity);
  const tier = p.tier ? ` <span class="mono">${esc(p.tier)}</span>` : '';
  return `<div class="rarity r${p.rarity}" title="${t('Rarity')}"><span class="stars">${stars}</span><span>${t(RARITY_LABELS[p.rarityName])}</span>${tier}</div>`;
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
  $('party-count').textContent = t('{n} / 6 drafted', {n: draft.team.length});

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
  $('round-label').textContent = draft.complete ? t('Complete') : t('Round {n} of 6', {n: draft.offer!.roundNumber});
}
function renderEncounter(draft: SessionView): void {
  const o = draft.offer!;
  const totalSkips = draft.draftConfig.manualSkipCount;
  $('encounter').innerHTML = `
    <div>
      <p class="eyebrow" style="margin:0 0 .25rem">${t('Wild cell')}</p>
      <div class="cell-name"><span style="color:${typeColor(o.cell.type)}">${typeName(o.cell.type)}</span> · ${t('Gen {n}', {n: o.cell.generation})}</div>
      <p class="odds-note">${t('Slot odds — Poké Ball {c}% · Great Ball {u}% · Ultra Ball {r}% · Master Ball {l}%', {c: o.rarityOdds[0], u: o.rarityOdds[1], r: o.rarityOdds[2], l: o.rarityOdds[3]})}</p>
      ${o.nativeCount < o.thinCellThreshold ? `<p class="thin-note">${t('Thin cell — only {n} from this generation; the rest are visitors from nearby generations.', {n: o.nativeCount})}</p>` : ''}
    </div>
    <div class="encounter-actions">
      <button class="btn btn-ghost btn-sm" onclick="skip()" ${draft.skipsRemaining ? '' : 'disabled'}>
        ${t('Skip cell ({a}/{b})', {a: draft.skipsRemaining, b: totalSkips})}
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
    return `
    <article class="mon${p.visitor ? ' visitor' : ''}">
      <div class="mon-top">
        <span class="mon-badge">${t('Gen {g} · BST {b}', {g: p.debutGeneration, b: p.baseStatTotal})}</span>
        <div class="sprite-frame">${sprite(p)}</div>
        <div class="mon-name">${monName(p)}</div>
        <div class="chips">${typeChips(p)}</div>
      </div>
      <div class="mon-body">
        ${rarityRow(p)}
        ${setSummary(p)}
      </div>
      <button class="btn btn-primary pick" onclick="pick('${p.id}')">${t('Pick {name}', {name: monName(p)})}</button>
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
         <span class="info"><strong>${monName(p)}</strong>
         <span>${t('Gen {g} · BST {b}', {g: p.debutGeneration, b: p.baseStatTotal})}</span></span></li>`
    : `<li class="slot empty"><span class="pokeball ball"></span><span class="info"><strong>${t('Slot {n}', {n: i + 1})}</strong><span>${t('Empty')}</span></span></li>`,
  ).join('');
  fixImages(root);
}

function newRun(): void {
  go('draft');
  $('encounter').innerHTML = `<div><p class="lead">${t('Rolling the first cell…')}</p></div>`;
  try {
    if (!state.ctx) throw new Error(t('game data is still loading'));
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

async function copyExport(): Promise<void> {
  if (!state.teamExport) return;
  try {
    await navigator.clipboard.writeText(state.teamExport);
    document.querySelectorAll<HTMLButtonElement>('#copy-export').forEach((b) => { const was = b.textContent; b.textContent = t('Copied ✓'); setTimeout(() => { b.textContent = was; }, 1200); });
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
        <div class="loadout-head"><span class="mini">${sprite(entry)}</span><strong>${monName({id: entry.speciesId, name: entry.name})}</strong></div>
        <label class="field set-field">${t('Set')} ${picker}</label>
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
function bossName(b: BossInfo): string { return b.source === 'custom' ? t('{name} (pasted)', {name: b.name}) : b.source === 'edited' ? t('{name} (edited)', {name: b.name}) : b.name; }
function renderBosses(bosses: BossInfo[]): void {
  state.bosses = bosses;
  const ladder = $('ladder');
  ladder.innerHTML = bosses.map((b, i) => `
    <li class="boss" draggable="true" data-index="${i}">
      <span class="handle" aria-hidden="true">⠿</span>
      <span class="num">${i + 1}</span>
      <span class="bname">${esc(b.name)}</span>
      ${b.source === 'custom' || b.source === 'edited' ? `<span class="tag">${t(b.source)}</span>` : ''}
      <span class="acts">
        <button class="btn btn-ghost btn-sm" onclick="editBoss(${i})">${t('Edit')}</button>
        <button class="btn btn-danger btn-sm" onclick="discardBoss(${i})" ${bosses.length <= BOSS_ORDER_MIN ? 'disabled' : ''}>✕</button>
      </span>
    </li>`).join('');
  wireDrag(ladder);
  const sel = $<HTMLSelectElement>('boss-select');
  sel.replaceChildren(...bosses.map((b) => { const o = document.createElement('option'); o.value = b.id; o.textContent = bossName(b); return o; }));
  $<HTMLButtonElement>('run-btn').disabled = bosses.length === 0;
  $<HTMLButtonElement>('exhibition-btn').disabled = bosses.length === 0;
  if (bosses.length === 0) $('boss-status').textContent = t('No bosses found under rollmons/bosses/.');
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
  if (state.bosses.length <= BOSS_ORDER_MIN) { $('boss-form-status').textContent = t('At least one boss must remain.'); return; }
  renderBosses(state.bosses.filter((_, j) => j !== i)); resetBossForm();
}
function editBoss(i: number): void {
  const b = state.bosses[i]; const st = $('boss-form-status');
  try {
    const d = state.bossBook!.info(b.id);
    $<HTMLInputElement>('boss-id').value = d.id;
    $<HTMLInputElement>('boss-name').value = d.name;
    $<HTMLTextAreaElement>('boss-export').value = d.export;
    $('boss-form-title').textContent = t('Edit {name}', {name: d.name});
    $('boss-save').textContent = t('Save boss');
    $('boss-cancel').classList.remove('hidden');
    st.textContent = t('Validate and save to apply.');
  } catch (e) { st.textContent = errorMessage(e); }
}
function resetBossForm(): void {
  $<HTMLFormElement>('boss-form').reset();
  $<HTMLInputElement>('boss-id').value = '';
  $('boss-form-title').textContent = t('Add a boss');
  $('boss-save').textContent = t('Add boss');
  $('boss-cancel').classList.add('hidden');
}
function saveBoss(e: Event): void {
  e.preventDefault();
  const st = $('boss-form-status');
  const id = $<HTMLInputElement>('boss-id').value;
  const name = $<HTMLInputElement>('boss-name').value.trim();
  const exp = $<HTMLTextAreaElement>('boss-export').value.trim();
  if (!name || !exp) { st.textContent = t('Name and export are required.'); return; }
  if (!id && state.bosses.length >= BOSS_ORDER_MAX) { st.textContent = t('A run can hold at most {n} bosses.', {n: BOSS_ORDER_MAX}); return; }
  st.textContent = t('Validating…');
  try {
    const boss = id ? state.bossBook!.edit(id, name, exp) : state.bossBook!.addCustom(name, exp);
    renderBosses(id ? state.bosses.map((b) => (b.id === boss.id ? boss : b)) : [...state.bosses, boss]);
    resetBossForm(); st.textContent = id ? t('Saved {name}.', {name: boss.name}) : t('Added {name}.', {name: boss.name});
  } catch (err) { st.textContent = t('Does not validate: {error}', {error: errorMessage(err)}); }
}

/* =====================================================================
   RUN / BATTLE  (Showdown replay viewport untouched)
   ===================================================================== */
function renderRail(gauntlet: GauntletView): void {
  const rail = $('rail');
  if (!gauntlet.bosses.length) { rail.innerHTML = ''; return; }
  const now = nowIndex(gauntlet);
  rail.innerHTML = gauntlet.bosses.map((b, i) => {
    const r = gauntlet.results[i];
    const seen = !!r && watched.has(r.battleId);
    let cls = '', label = t('Waiting');
    if (seen) { cls = r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie'; label = `${r.turns}t`; }
    else if (i === now) { cls = 'current'; label = t('Now'); }
    // In the campaign the player did not choose the order, so bosses not yet reached stay hidden.
    const name = gauntlet.campaign && i > now ? '???' : b.name;
    // A watched battle's rail entry scrolls its replay card into view.
    const attrs = seen ? ` class="${cls} clickable" onclick="jumpToReplay('${r.battleId}')" title="${t('Watch this battle')}" role="button" tabindex="0"` : ` class="${cls}"`;
    return `<li${attrs}><span class="dot"></span><span>${i + 1}. ${esc(name)}</span><small>${label}</small></li>`;
  }).join('');
}
const resultChip = (r: BattleResult) => {
  const cls = r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie';
  const label = r.winner === 'tie' ? t('Tie') : t('{name} wins', {name: r.winner === 'player' ? r.playerName : r.bossName});
  return {cls, label, html: `<span class="res ${cls}">${esc(label)} · ${r.turns}t</span>`};
};
/* A battle's card is created when the battle starts (docs/ROADMAP.md §4): the
   replay player inside animates the protocol lines as the worker streams
   them, so the player watches the fight live instead of waiting for the end. */
function mountLiveCard(spec: BattleSpec): LiveReplay {
  const theater = $('theater');
  theater.querySelector('.replay-placeholder')?.remove();
  const card = document.createElement('div');
  card.className = 'replay-card'; card.dataset.bid = spec.battleId; card.dataset.live = '1';
  card.innerHTML = `
    <div class="replay-head">
      <h3>${esc(PLAYER_NAME)} <span style="color:var(--faint)">${t('vs')}</span> ${esc(spec.bossName)}</h3>
      <span class="res live">${t('Live · turn {n}', {n: 1})}</span>
    </div>`;
  theater.appendChild(card);
  return mountLiveReplay(card, spec.bossName, PLAYER_NAME);
}
function liveTurn(spec: BattleSpec, turn: number): void {
  const chip = document.querySelector(`#theater [data-bid="${spec.battleId}"] .res.live`);
  if (chip) chip.textContent = t('Live · turn {n}', {n: turn});
}
/* A battle counts as *watched* once its live player has animated to the end
   (or no player appeared within a grace period, e.g. the hosted client is
   blocked). Everything that would spoil the outcome waits for that: the
   result chip, the rail entry, the next battle (runNext gates on it), the
   names of later campaign bosses, and the summary button. */
const livePlayer = (card: Element | null) => {
  const w = card?.querySelector<HTMLIFrameElement>('iframe.replay-frame')?.contentWindow as (Window & {rollmonsLive?: {battle: {ended: boolean}}}) | null | undefined;
  return w?.rollmonsLive?.battle;
};
const NO_PLAYER_GRACE_MS = 10_000;
const watched = new Set<string>();
const heldResults = new Map<string, {html: string; since: number}>(); // battleId -> result chip
const watchers = new Map<string, () => void>(); // battleId -> resolver of whenWatched()
let revealTimer: number | undefined;
function markWatched(bid: string): void {
  if (watched.has(bid)) return;
  watched.add(bid);
  watchers.get(bid)?.(); watchers.delete(bid);
  const session = state.session;
  if (!session) return;
  const g = session.gauntletView();
  renderRail(g);
  if (g.complete && allWatched(g) && !state.gauntletRunning) $('battle-lead').textContent = t('Run complete — view the summary.');
  updateSummaryAccess();
}
function revealWatchedResults(): void {
  for (const [bid, held] of heldResults) {
    const card = document.querySelector(`#theater [data-bid="${bid}"]`);
    if (!card) { heldResults.delete(bid); markWatched(bid); continue; }
    const b = livePlayer(card);
    const done = b ? b.ended : Date.now() - held.since > NO_PLAYER_GRACE_MS;
    if (!done) continue;
    const chip = card.querySelector('.res.live');
    if (chip) chip.outerHTML = held.html;
    heldResults.delete(bid); markWatched(bid);
  }
  if (!heldResults.size && revealTimer) { clearInterval(revealTimer); revealTimer = undefined; }
}
function holdResult(battleId: string, chipHtml: string): void {
  if (heldResults.has(battleId) || watched.has(battleId)) return;
  heldResults.set(battleId, {html: chipHtml, since: Date.now()});
  if (!revealTimer) revealTimer = window.setInterval(revealWatchedResults, 500);
  revealWatchedResults();
}
/** Resolves once the battle has been watched (immediately with ?gate=0). */
function whenWatched(battleId: string): Promise<void> {
  if (!GATE || watched.has(battleId)) return Promise.resolve();
  return new Promise((resolve) => watchers.set(battleId, resolve));
}
const allWatched = (g: GauntletView) => g.results.every((r) => watched.has(r.battleId));
/** Index of the battle being watched (or, when all are watched, the one the engine plays next). */
function nowIndex(g: GauntletView): number {
  const i = g.results.findIndex((r) => !watched.has(r.battleId));
  return i >= 0 ? i : g.nextIndex;
}
/** The summary opens only once the run is over and its last battle has been watched. */
function updateSummaryAccess(): void {
  const g = state.session?.gauntletView();
  const ready = !!g && g.complete && !state.gauntletRunning && allWatched(g);
  $<HTMLButtonElement>('to-results').disabled = !ready;
  $('summary-fab').classList.toggle('hidden', !(ready && currentScreen === 'battle'));
}
function liveLines(live: LiveReplay, lines: string[]): void {
  live.add(lines);
  const card = live.frame.parentElement;
  if (card) card.dataset.lines = String(live.lines); // read by scripts/chrome-app.mjs
}
function renderTheater(results: BattleResult[]): void {
  const theater = $('theater');
  if (!results.length) {
    theater.innerHTML = `<div class="replay-card replay-placeholder"><div class="replay-ph"><div><div class="big">${t('Waiting for the first battle…')}</div><div class="sm">${t('Matchups stream in here as your team climbs the ladder.')}</div></div></div></div>`;
    return;
  }
  // The first real battle replaces the waiting placeholder.
  theater.querySelector('.replay-placeholder')?.remove();
  const seen = new Set(Array.from(theater.querySelectorAll<HTMLElement>('[data-bid]'), (n) => n.dataset.bid));
  results.forEach((r) => {
    const chip = resultChip(r);
    if (seen.has(r.battleId)) {
      // a live card: the player already holds the whole log, so only the chip changes
      if (theater.querySelector(`[data-bid="${r.battleId}"] .res.live`)) holdResult(r.battleId, chip.html);
      else markWatched(r.battleId);
      return;
    }
    markWatched(r.battleId); // a card built after the fact has nothing left to spoil
    const card = document.createElement('div');
    card.className = 'replay-card'; card.dataset.bid = r.battleId;
    card.innerHTML = `
      <div class="replay-head">
        <h3>${esc(r.playerName)} <span style="color:var(--faint)">${t('vs')}</span> ${esc(r.bossName)}</h3>
        ${chip.html}
      </div>`;
    if (r.log.length) {
      // The srcdoc is deferred until the card is visible: the Showdown player
      // measures its container on init (see replay/embed.ts).
      mountReplay(card, r.log, r.bossName, r.playerName);
    } else {
      const ph = document.createElement('div'); ph.className = 'replay-ph';
      ph.innerHTML = `<div><div class="big">${t('No replay for this battle')}</div><div class="sm">${esc(t('{label} in {n} turns.', {label: chip.label, n: r.turns}))}</div></div>`;
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
  if (g.bosses.length && !(g.complete && allWatched(g))) {
    const now = nowIndex(g), nb = g.bosses[now];
    if (nb) $('battle-lead').textContent = t('Now battling {name} — {i} of {n}.', {name: nb.name, i: now + 1, n: g.bosses.length});
  }
  updateSummaryAccess();
}

function orderedBossIds(): string[] { return state.bosses.map((b) => b.id); }

function requireSession(): GameSession | null {
  if (!state.session) { $('boss-status').textContent = t('Draft a team first.'); return null; }
  return state.session;
}

function startRun(stopOnLoss: boolean): void {
  const session = requireSession();
  if (!session) return;
  if (state.bosses.length < BOSS_ORDER_MIN) { $('boss-status').textContent = t('Add at least one boss first.'); return; }
  go('battle');
  $('battle-lead').textContent = stopOnLoss ? t('Climbing the ladder — one loss ends the run.') : t('Exhibition — playing every boss.');
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
  $('battle-lead').textContent = t('Tiered campaign — 10 battles, one random team drawn per level.');
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
    const live = mountLiveCard(spec);
    const outcome = await battles.run({
      p1: {name: PLAYER_NAME, team: spec.playerTeam}, p2: {name: spec.bossName, team: spec.bossTeam}, seed: spec.seed, budgetMs: budgetMs(),
      onTurn: (e) => { if (state.session === session) { $('battle-lead').textContent = t('Now battling {name} — turn {n}.', {name: spec.bossName, n: e.turn}); liveTurn(spec, e.turn); } },
      onLog: (lines) => { if (state.session === session) liveLines(live, lines); },
    });
    if (state.session !== session) return; // a new run started meanwhile
    session.recordGauntletBattle(spec, outcome);
    renderRun(refreshView());
    if (session.gauntletComplete) { finishRun(); return; }
    // The next battle starts only once this one has been watched to the end.
    await whenWatched(spec.battleId);
    if (state.session === session && state.gauntletRunning) setTimeout(runNext, 400);
  } catch (e) { $('battle-lead').textContent = errorMessage(e); state.gauntletRunning = false; }
}
function finishRun(): void {
  state.gauntletRunning = false;
  const view = refreshView();
  renderRun(view);
  renderResults(view.gauntlet);
  // No auto-navigation: the summary button (and the fixed one top right)
  // unlock once the last battle has been watched, so a loss is not spoiled.
  if (allWatched(view.gauntlet)) $('battle-lead').textContent = t('Run complete — view the summary.');
  updateSummaryAccess();
}

async function battleOne(): Promise<void> {
  const session = requireSession();
  if (!session) return;
  const id = $<HTMLSelectElement>('boss-select').value;
  if (!id) { $('boss-status').textContent = t('Pick a boss to test.'); return; }
  go('battle');
  $('battle-lead').textContent = t('Single exhibition battle.');
  $('theater').innerHTML = '';
  try {
    const spec = session.singleBattleSpec(id);
    const live = mountLiveCard(spec);
    const outcome = await battles.run({
      p1: {name: PLAYER_NAME, team: spec.playerTeam}, p2: {name: spec.bossName, team: spec.bossTeam}, seed: spec.seed, budgetMs: budgetMs(),
      onTurn: (e) => { if (state.session === session) liveTurn(spec, e.turn); },
      onLog: (lines) => { if (state.session === session) liveLines(live, lines); },
    });
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
  $('result-eyebrow').textContent = t('{n}-battle campaign', {n: total});
  $('result-title').textContent = cleared ? t('Champion! 🏆') : lastLoss ? t('Run ended') : t('Gauntlet complete');
  $('result-record').textContent = `${wins}–${losses}${ties ? `–${ties}` : ''}  ·  ${t('cleared {w}/{t}', {w: wins, t: total})}  ·  ${t('{avg} avg turns', {avg: avg.toFixed(1)})}`;

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
          <span class="dmg-mon">${sp ? sprite({spriteUrl: sp}, 'mini') : '<span class="asset-host mini"></span>'}<span class="dmg-name">${monName(e)}${isMvp ? `<span class="mvp-tag">${t('MVP')}</span>` : ''}</span></span>
          <span class="dmg-track"><i style="width:${w}%"></i></span>
          <span class="dmg-num"><b>${e.contribution.toFixed(1)}%</b><small>${t('{n}% dealt', {n: e.damage.toFixed(0)})}</small></span>
        </div>`;
      }).join('')
    : `<p class="panel-note" style="padding:.5rem">${t('No damage was recorded this run.')}</p>`;
  fixImages($('damage-bars'));

  const mvpEl = $('mvp-card');
  if (dmg.mvp) {
    const sp = spriteByName[String(dmg.mvp.name).toLowerCase()];
    mvpEl.classList.remove('hidden');
    mvpEl.innerHTML = `<p class="eyebrow">${t('Run MVP')}</p>
      <div class="mvp-body">
        ${sp ? sprite({spriteUrl: sp}, 'mvp-sprite') : ''}
        <div class="mvp-meta">
          <strong>${monName(dmg.mvp)}</strong>
          <p class="mvp-share">${dmg.mvp.contribution.toFixed(1)}%</p>
          <p class="panel-note">${t('of team damage · {n}% HP dealt', {n: dmg.mvp.damage.toFixed(0)})}</p>
        </div>
      </div>`;
    fixImages(mvpEl);
  } else { mvpEl.classList.add('hidden'); }

  $('stat-tiles').innerHTML = `
    <div class="stat win"><div class="v">${wins}</div><div class="k">${t('Wins')}</div></div>
    <div class="stat loss"><div class="v">${losses}</div><div class="k">${t('Losses')}</div></div>
    ${ties ? `<div class="stat"><div class="v">${ties}</div><div class="k">${t('Ties')}</div></div>` : ''}
    <div class="stat"><div class="v">${avg.toFixed(1)}</div><div class="k">${t('Avg turns')}</div></div>`;

  renderScore(g);

  $('ladder-results').innerHTML = g.bosses.map((b, i) => {
    const r = results[i];
    const cls = !r ? 'pending' : r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie';
    const label = !r ? t('Not reached') : r.winner === 'tie' ? t('Tie') : r.winner === 'player' ? t('Win') : t('Loss');
    const attrs = r ? `onclick="jumpToReplay('${r.battleId}')" title="${t('Watch this battle')}" role="button" tabindex="0"` : '';
    return `<li class="ladder-row ${cls}${r ? ' clickable' : ''}" ${attrs}><span class="ln">${i + 1}</span><span class="lname">${esc(b.name)}</span><span class="lres">${label}${r ? ` · ${r.turns}t` : ''}</span></li>`;
  }).join('');
}

/* =====================================================================
   LEADERBOARD
   ===================================================================== */
const BAND_LABEL: Record<string, string> = {level_1: 'Cakewalk', level_2: 'Meme', level_3: 'Red', middle: 'Middle', advanced: 'Advanced', level_10: 'Air'};
let submittedFor: string | null = null; // battleId of the last battle of the run already submitted
function renderScore(g: GauntletView): void {
  const card = $('score-card');
  const score = g.score;
  if (!score) { card.classList.add('hidden'); card.innerHTML = ''; return; }
  card.classList.remove('hidden');
  const won = score.battles.filter((b) => b.won);
  const rows = won.map((b) => `<li><span>${esc(g.bosses[b.index]?.name ?? '')} <small>(${t(BAND_LABEL[b.band] ?? b.band)})</small></span><b>${(b.points * b.speedBonus).toFixed(1)}</b></li>`).join('');
  const proof = state.session?.runProof() ?? null;
  const runKey = g.results.at(-1)?.battleId ?? null;
  const already = runKey !== null && submittedFor === runKey;
  const post = !proof || already ? `<p class="score-status">${already ? t('Submitted.') : t('Only fresh campaign runs can be submitted.')}</p>`
    : !AUTH_ENABLED ? `<p class="score-status">${t('Scores can only be posted on the hosted site.')}</p>`
    : account ? `<p class="score-submit"><button class="btn btn-primary btn-sm" id="score-post" onclick="submitScore()">${t('Post as {name}', {name: esc(account.name)})}</button></p>`
    : `<p class="score-submit"><button class="btn btn-primary btn-sm" id="score-signin" onclick="openAuth('login')">${t('Sign in to post')}</button></p>`;
  card.innerHTML = `<p class="eyebrow">${t('Score')}</p>
    <div class="score-total"><span class="v" id="score-total">${score.total}</span><span class="k">${t('points')}</span></div>
    <ul class="score-rows">${rows || `<li><span>${t('No wins')}</span><b>0</b></li>`}
      <li><span>${t('Base (wins × speed)')}</span><b>${score.base.toFixed(1)}</b></li>
      <li><span>${t('Team handicap')} <small>${t('(by tier)')}</small></span><b>× ${score.handicap.toFixed(2)}</b></li></ul>
    ${post}
    <p class="score-status" id="score-status"></p>`;
}
async function submitScore(): Promise<void> {
  const session = state.session;
  const proof = session?.runProof();
  const status = $('score-status');
  if (!session || !proof) { status.textContent = t('This run cannot be submitted.'); return; }
  const btn = document.querySelector<HTMLButtonElement>('#score-post');
  if (btn) btn.disabled = true;
  status.textContent = t('Verifying your run…');
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({proof})});
    const body = await res.json().catch(() => ({})) as {rank?: number; score?: number; best?: number; error?: string};
    if (res.status === 401) { account = null; renderAccount(); openAuth('login'); throw new Error(body.error || 'sign in first'); }
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    submittedFor = session.gauntletView().results.at(-1)?.battleId ?? null;
    status.textContent = body.best !== undefined && body.score !== undefined && body.best > body.score
      ? t('Verified! Your best is still {best} points (#{rank}).', {best: body.best, rank: body.rank ?? '?'})
      : t('Verified! You are #{rank} on the leaderboard.', {rank: body.rank ?? '?'});
    btn?.parentElement?.remove();
    void loadBoard();
  } catch (e) {
    status.textContent = t('Could not submit: {error}', {error: errorMessage(e)});
    if (btn) btn.disabled = false;
  }
}
interface BoardEntry { name: string; score: number; wins: number; battles: number; team: string[]; createdAt: string }
// undefined = not fetched yet (the button is shown from the first paint so the
// strip does not reflow), null = no board here (hidden).
let boardEntries: BoardEntry[] | null | undefined;
function renderBoard(): void {
  const entries = boardEntries;
  const btn = $('board-btn');
  btn.classList.toggle('hidden', entries === null);
  btn.dataset.state = entries === undefined ? 'loading' : entries ? 'ready' : 'off';
  if (!entries) { $('board-card').innerHTML = `<p class="panel-note">${t('Loading…')}</p>`; return; }
  $('board-card').innerHTML = `<p class="panel-note">${t('top {n} · best run per player', {n: entries.length})}</p>
    <ol class="board-list">${entries.map((e, i) => `<li><span class="rank">#${i + 1}</span><span>${esc(e.name)}<small>${t('{w}/{b} wins', {w: e.wins, b: e.battles})} · ${e.team.map((id) => monName({id, name: id})).join(', ')}</small></span><span class="score">${e.score}</span></li>`).join('') || `<li><span></span><span>${t('No runs yet. Be the first!')}</span><span></span></li>`}</ol>`;
}
async function loadBoard(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=10`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    boardEntries = (await res.json() as {entries: BoardEntry[]}).entries;
  } catch {
    boardEntries = null; // no API here (local build, or the function is not configured)
  }
  renderBoard();
}
function toggleBoard(): void {
  const open = $('board-drawer').classList.contains('hidden');
  $('board-drawer').classList.toggle('hidden', !open);
  $('board-backdrop').classList.toggle('hidden', !open);
  if (open && boardEntries !== null) void loadBoard();
}

/* ---- accounts (Showdown-style name + password; the session is a same-origin cookie) */
let account: {name: string} | null = null;
let authModeNow: 'login' | 'register' = 'login';
function renderAccount(): void {
  const el = $('account');
  if (!AUTH_ENABLED) { el.innerHTML = ''; return; }
  el.innerHTML = account
    ? `<span class="who" title="${esc(account.name)}">${esc(account.name)}</span><button class="btn btn-ghost btn-sm" id="signout-btn" onclick="logout()">${t('Sign out')}</button>`
    : `<button class="btn btn-ghost btn-sm" id="signin-btn" onclick="openAuth('login')">${t('Sign in')}</button>`;
}
async function loadAccount(): Promise<void> {
  if (!AUTH_ENABLED) return;
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`);
    if (res.ok) account = (await res.json() as {user: {name: string} | null}).user;
  } catch { /* offline */ }
  renderAccount();
}
function openAuth(mode: 'login' | 'register'): void {
  authMode(mode);
  $('auth-error').textContent = '';
  $<HTMLInputElement>('auth-password').value = '';
  $<HTMLDialogElement>('auth-dialog').showModal();
  $('auth-name').focus();
}
function authMode(mode: 'login' | 'register'): void {
  authModeNow = mode;
  document.querySelectorAll<HTMLElement>('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('auth-submit').textContent = mode === 'register' ? t('Create account') : t('Log in');
  $('auth-note').classList.toggle('hidden', mode !== 'register');
  $<HTMLInputElement>('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
}
function closeAuth(): void { $<HTMLDialogElement>('auth-dialog').close(); }
async function submitAuth(ev: Event): Promise<void> {
  ev.preventDefault();
  const name = $<HTMLInputElement>('auth-name').value.trim();
  const password = $<HTMLInputElement>('auth-password').value;
  const btn = $<HTMLButtonElement>('auth-submit'), err = $('auth-error');
  btn.disabled = true;
  err.textContent = t('Signing in…');
  try {
    const res = await fetch(`${API_BASE}/api/auth/${authModeNow}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, password})});
    const body = await res.json().catch(() => ({})) as {user?: {name: string}; error?: string};
    if (!res.ok || !body.user) throw new Error(body.error || `HTTP ${res.status}`);
    account = body.user;
    err.textContent = '';
    closeAuth();
    renderAccount();
    if (state.view) renderScore(state.view.gauntlet);
  } catch (e) {
    err.textContent = errorMessage(e);
  } finally {
    btn.disabled = false;
  }
}
async function logout(): Promise<void> {
  try { await fetch(`${API_BASE}/api/auth/logout`, {method: 'POST'}); } catch { /* offline */ }
  account = null;
  renderAccount();
  if (state.view) renderScore(state.view.gauntlet);
}

/* =====================================================================
   POOL — PokéRogue-style starter select (docs/ROADMAP.md §8)
   ===================================================================== */
type PoolSort = 'dex' | 'bst' | 'name';
const poolUi: {gen: number; type: string; rarity: number; sort: PoolSort; selected: string} = {gen: 0, type: '', rarity: -1, sort: 'dex', selected: ''};
const POOL_TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];

function poolFilter(kind: 'gen' | 'type' | 'rarity' | 'sort', value: string | number): void {
  if (kind === 'gen') poolUi.gen = Number(value);
  else if (kind === 'type') poolUi.type = String(value);
  else if (kind === 'rarity') poolUi.rarity = Number(value);
  else poolUi.sort = value as PoolSort;
  renderPool();
}
function poolSelect(id: string): void { poolUi.selected = id; renderPool(); }

function poolList(): SpeciesView[] {
  const list = state.pool!.filter((p) => (!poolUi.gen || p.debutGeneration === poolUi.gen)
    && (!poolUi.type || p.types.includes(poolUi.type)) && (poolUi.rarity < 0 || p.rarity === poolUi.rarity));
  if (poolUi.sort === 'bst') list.sort((a, b) => b.baseStatTotal - a.baseStatTotal || a.dexNumber - b.dexNumber);
  else if (poolUi.sort === 'name') list.sort((a, b) => monName(a).localeCompare(monName(b)));
  return list;
}

function renderPool(): void {
  if (!state.pool || !state.matrix) return;
  const list = poolList();
  if (!list.some((p) => p.id === poolUi.selected)) poolUi.selected = list[0]?.id ?? '';
  const tab = (on: boolean, onclick: string, label: string) => `<button class="ftab${on ? ' on' : ''}" onclick="${onclick}">${label}</button>`;
  $('pool-filters').innerHTML = `
    <div class="frow"><span class="flabel">${t('Gen')}</span>${tab(!poolUi.gen, "poolFilter('gen',0)", t('All'))}${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => tab(poolUi.gen === g, `poolFilter('gen',${g})`, String(g))).join('')}</div>
    <div class="frow"><span class="flabel">${t('Type')}</span>${tab(!poolUi.type, "poolFilter('type','')", t('All'))}${POOL_TYPES.map((x) => tab(poolUi.type === x, `poolFilter('type','${x}')`, `<span class="dot" style="--tc:${typeColor(x)}"></span>${typeName(x)}`)).join('')}</div>
    <div class="frow"><span class="flabel">${t('Rarity')}</span>${tab(poolUi.rarity < 0, "poolFilter('rarity',-1)", t('All'))}${RARITY_NAMES.map((name, r) => tab(poolUi.rarity === r, `poolFilter('rarity',${r})`, t(RARITY_LABELS[name]))).join('')}</div>
    <div class="frow"><span class="flabel">${t('Sort')}</span>${(['dex', 'bst', 'name'] as const).map((k) => tab(poolUi.sort === k, `poolFilter('sort','${k}')`, t({dex: 'Dex', bst: 'BST', name: 'Name'}[k]))).join('')}</div>`;
  // one cell chosen: say how many natives it has and whether it is thin
  let cellNote = '';
  if (poolUi.gen && poolUi.type) {
    const cell = state.matrix.cells.find((c) => c.type === poolUi.type && c.generation === poolUi.gen);
    if (cell) cellNote = ` · ${typeName(cell.type)} · ${t('Gen {n}', {n: cell.generation})}: ${t('{n} natives', {n: cell.eligibleCount})}${cell.state === 'thin' ? ` (${t('thin')})` : ''}`;
  }
  $('pool-summary').textContent = t('{n} of {m} draftable Pokémon', {n: list.length, m: state.pool.length}) + cellNote;
  $('pool-grid').innerHTML = list.map((p) => `<button class="pmon${p.id === poolUi.selected ? ' sel' : ''}" title="${esc(monName(p))}" onclick="poolSelect('${p.id}')">
    <img class="asset" src="${p.pixelSpriteUrl}" alt="" loading="lazy"><span class="cost r${p.rarity}">${p.rarity + 1}</span></button>`).join('');
  renderPoolDetail(list.find((p) => p.id === poolUi.selected) ?? null);
}

function renderPoolDetail(p: SpeciesView | null): void {
  const d = $('pool-detail');
  if (!p) { d.innerHTML = `<p class="pool-empty">${t('No Pokémon match these filters.')}</p>`; return; }
  const moveData = (move: string) => state.ctx!.data.moves[move.toLowerCase().replace(/[^a-z0-9]/g, '')] as {type?: string; name?: string} | undefined;
  const moveType = (move: string) => String(moveData(move)?.type ?? 'normal').toLowerCase();
  const moveName = (move: string) => moveData(move)?.name ?? titleCase(move);
  const cells = p.types.map((x) => {
    const cell = state.matrix!.cells.find((c) => c.type === x && c.generation === p.debutGeneration);
    return `${typeName(x)} ${cell?.eligibleCount ?? 0}`;
  }).join(' · ');
  const stars = '★'.repeat(p.rarity + 1) + '☆'.repeat(3 - p.rarity);
  d.innerHTML = `
    <div class="pool-art">
      <div class="pool-dex"><span>No ${String(p.dexNumber).padStart(4, '0')}</span><span>${t('Gen {n}', {n: p.debutGeneration})}</span></div>
      <div class="pool-sprite"><img class="asset" src="${p.pixelSpriteUrl}" alt=""></div>
    </div>
    <div class="pool-info">
      <h2 class="pool-name">${monName(p)}</h2>
      <div class="pool-types">${p.types.map((x) => `<span class="ptype t-${x}">${typeName(x)}</span>`).join('')}</div>
      <dl class="pool-rows">
        <div><dt>${t('Rarity')}</dt><dd class="r${p.rarity}">${stars} ${t(RARITY_LABELS[p.rarityName])}</dd></div>
        <div><dt>${t('Tier')}</dt><dd>${p.tier ? esc(p.tier) : '—'}</dd></div>
        <div><dt>${t('BST')}</dt><dd>${p.baseStatTotal}</dd></div>
        <div><dt>${t('Cells')}</dt><dd>${cells}</dd></div>
      </dl>
      <div class="pool-set">
        <div class="pool-set-head">${esc(p.set.label)}</div>
        <div class="pool-kv">${esc(p.set.item ? titleCase(p.set.item) : '—')} · ${esc(titleCase(p.set.ability))}</div>
        <ul class="pool-moves">${p.set.moves.map((mv) => `<li class="pmove t-${moveType(mv)}">${esc(moveName(mv))}</li>`).join('')}</ul>
      </div>
    </div>`;
  fixImages(d);
}

/** Feed the title roller with the draft pool (names in the current language). */
function feedRoller(): void {
  if (!state.pool) return;
  setRollerPool(state.pool.map((p) => ({name: monName(p), gen: p.debutGeneration, types: p.types, animatedSpriteUrl: p.animatedSpriteUrl, pixelSpriteUrl: p.pixelSpriteUrl})));
}

/* =====================================================================
   BOOT
   ===================================================================== */
// The markup uses inline onclick handlers (carried over from v1), so the
// handlers it names are published on window.
Object.assign(window, {go, togglePool, jumpToReplay, newRun, pick, skip, copyExport, poolFilter, poolSelect, chooseSet, editBoss, discardBoss, resetBossForm, startRun, startCampaign, battleOne, rollMon, setLowPower, submitScore, setLanguage, toggleBoard, openAuth, authMode, closeAuth, submitAuth, logout});
declare global { interface Window { __rollmons: {view: () => SessionView | null; screen: () => string; ready: Promise<string>} } }

$('boss-form').addEventListener('submit', saveBoss);

async function boot(): Promise<void> {
  initLang(params.get('lang'));
  applyStatic(document);
  go('title');
  initRoller(typeName);
  // The tools strip is painted in its final shape right away ("Sign in" plus the
  // board button) and the two API calls run alongside the game-data load.
  renderBoard();
  renderAccount();
  void loadBoard();
  void loadAccount();
  $<HTMLInputElement>('low-power').checked = lowPower;
  $('title-foot').textContent = t('Loading game data…');
  try {
    const res = await fetch(new URL('./data/game-data.json', import.meta.url));
    if (!res.ok) throw new Error(`game data: HTTP ${res.status}`);
    const data = (await res.json()) as GameData;
    state.ctx = createGameContext(data);
    state.bossBook = new BossBook(state.ctx);
    state.matrix = matrixView(state.ctx);
    state.pool = poolSpecies(state.ctx);
    renderPool();
    feedRoller();
    renderBosses(state.bossBook.list());
    $('title-foot').textContent = t('Lv 100 · Gen 9 · engine-enforced dedupe');
  } catch (e) {
    $('pool-summary').textContent = errorMessage(e);
    $('title-foot').textContent = t('Could not load game data: {error}', {error: errorMessage(e)});
  }
}

window.__rollmons = {view: () => state.view, screen: () => currentScreen, ready: battles.ready()};
boot();
