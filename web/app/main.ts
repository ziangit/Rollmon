// The game page: port of v1's web_static/app.js with the FastAPI session
// replaced by GameSession (in-page) and battles run in the Web Worker.
// Screens, markup, and styles are carried over from v1.
import {BattleClient} from '../battle/client.ts';
import {DEFAULT_BUDGET_MS} from '../battle/runner.ts';
import type {GameData} from '../game/data.ts';
import {esc, mountLiveReplay, mountReplay, type LiveReplay} from '../replay/embed.ts';
import {
  BOSS_ORDER_MAX, BOSS_ORDER_MIN, BossBook, DraftError, GameSession, PLAYER_NAME, SessionError, createGameContext, matrixView,
  type BattleResult, type BattleSpec, type BossInfo, type GameContext, type GauntletView, type MatrixCellView, type MatrixView, type OfferView,
  type SessionView, type SpeciesView,
} from './session.ts';
import {initRoller, rollMon} from './roller.js';
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
}
const state: State = {ctx: null, bossBook: null, session: null, view: null, bosses: [], teamExport: '', gauntletRunning: false, matrix: null};

const params = new URLSearchParams(location.search);
// Dev knobs: ?seed=N makes the run reproducible; ?p1ms=&p2ms= set the search
// budgets and override the player's low-power switch (docs/ROADMAP.md §2).
/* Leaderboard API (docs/ROADMAP.md §7): the Vercel function; the GitHub
   Pages mirror calls the Vercel deployment cross-origin. ?api=<origin> overrides. */
const API_BASE = params.get('api') ?? (/\.vercel\.app$/.test(location.hostname) ? '' : 'https://rollmon.vercel.app');
const TOKEN_KEY = 'rollmons-token', NAME_KEY = 'rollmons-name';
function clientToken(): string | null {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t) { t = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem(TOKEN_KEY, t); }
    return t;
  } catch { return null; }
}
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
  if (state.matrix) renderMatrix();
  renderBoard();
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
  if (name === 'loadout') renderLoadout();
  // On the pool screen keep the step rail reflecting where Back will return to.
  updateSteps(name === 'pool' ? poolReturn : name);
  $('pokedex-btn').textContent = name === 'pool' ? t('← Back') : t('Pokédex');
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
function typeChips(p: {types: string[]; legendary?: boolean}): string {
  const chips = p.types.map((x) => `<span class="chip t-${x.toLowerCase()}">${typeName(x)}</span>`).join('');
  return chips + (p.legendary ? `<span class="chip legend">${t('Legendary')}</span>` : '');
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
  const thin = o.thinRerollAvailable ? `<button class="btn btn-warn btn-sm" onclick="thinReroll()">${t('↻ Free re-spin')}</button>` : '';
  $('encounter').innerHTML = `
    <div>
      <p class="eyebrow" style="margin:0 0 .25rem">${t('Wild cell')}</p>
      <div class="cell-name"><span style="color:${typeColor(o.cell.type)}">${typeName(o.cell.type)}</span> · ${t('Gen {n}', {n: o.cell.generation})}</div>
      ${o.thinRerollAvailable ? `<p class="thin-note">${t('Thin cell — fewer than {n} choices left, this re-spin is free.', {n: o.thinCellThreshold})}</p>` : ''}
    </div>
    <div class="encounter-actions">
      ${thin}
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
    const prob = p.selectionProbability * 100;
    return `
    <article class="mon">
      <div class="mon-top">
        <span class="mon-badge">${t('Gen {g} · BST {b}', {g: p.debutGeneration, b: p.baseStatTotal})}</span>
        <div class="sprite-frame">${sprite(p)}</div>
        <div class="mon-name">${monName(p)}</div>
        <div class="chips">${typeChips(p)}</div>
      </div>
      <div class="mon-body">
        <div class="prob" title="${t('Draft odds')}">
          <span>${t('Odds')}</span>
          <span class="bar"><i style="width:${Math.min(100, prob)}%"></i></span>
          <span class="mono">${prob.toFixed(1)}%</span>
        </div>
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
function thinReroll(): void { draftAction(() => state.session!.thinReroll()); }

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
  rail.innerHTML = gauntlet.bosses.map((b, i) => {
    const r = gauntlet.results[i];
    let cls = '', label = t('Waiting');
    if (r) { cls = r.winner === 'player' ? 'win' : r.winner === 'boss' ? 'loss' : 'tie'; label = `${r.turns}t`; }
    else if (b.current) { cls = 'current'; label = t('Now'); }
    // A finished battle's rail entry scrolls its replay card into view.
    const attrs = r ? ` class="${cls} clickable" onclick="jumpToReplay('${r.battleId}')" title="${t('Watch this battle')}" role="button" tabindex="0"` : ` class="${cls}"`;
    return `<li${attrs}><span class="dot"></span><span>${i + 1}. ${esc(b.name)}</span><small>${label}</small></li>`;
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
/* The result chip of a live card is held back until its player has animated
   to the end (or was never loaded), so watching a battle live is not spoiled
   by the engine finishing it seconds earlier. */
const livePlayer = (card: Element | null) => {
  const w = card?.querySelector<HTMLIFrameElement>('iframe.replay-frame')?.contentWindow as (Window & {rollmonsLive?: {battle: {ended: boolean}}}) | null | undefined;
  return w?.rollmonsLive?.battle;
};
const heldResults = new Map<string, string>(); // battleId -> result chip html
let revealTimer: number | undefined;
function revealWatchedResults(): void {
  for (const [bid, html] of heldResults) {
    const card = document.querySelector(`#theater [data-bid="${bid}"]`);
    const chip = card?.querySelector('.res.live');
    if (!card || !chip) { heldResults.delete(bid); continue; }
    const b = livePlayer(card);
    if (!b || b.ended) { chip.outerHTML = html; heldResults.delete(bid); }
  }
  if (!heldResults.size && revealTimer) { clearInterval(revealTimer); revealTimer = undefined; }
}
function holdResult(battleId: string, chipHtml: string): void {
  heldResults.set(battleId, chipHtml);
  if (!revealTimer) revealTimer = window.setInterval(revealWatchedResults, 500);
  revealWatchedResults();
}
/** True while any live player on the battle screen is still animating. */
function replaysStillPlaying(): boolean {
  return Array.from(document.querySelectorAll('#theater .replay-card')).some((c) => { const b = livePlayer(c); return !!b && !b.ended; });
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
      return;
    }
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
  if (!g.complete && g.bosses.length) {
    const nb = g.bosses[g.nextIndex];
    if (nb) $('battle-lead').textContent = t('Now battling {name} — {i} of {n}.', {name: nb.name, i: g.nextIndex + 1, n: g.bosses.length});
  }
  $<HTMLButtonElement>('to-results').disabled = !g.complete;
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
  // Don't pull the viewer away from a replay that is still playing.
  if (replaysStillPlaying()) $('battle-lead').textContent = t('Run complete — the replays are still playing. View the summary whenever you like.');
  else setTimeout(() => go('results'), 500);
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
  let name = '';
  try { name = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* private mode */ }
  card.innerHTML = `<p class="eyebrow">${t('Score')}</p>
    <div class="score-total"><span class="v" id="score-total">${score.total}</span><span class="k">${t('points')}</span></div>
    <ul class="score-rows">${rows || `<li><span>${t('No wins')}</span><b>0</b></li>`}
      <li><span>${t('Base (wins × speed)')}</span><b>${score.base.toFixed(1)}</b></li>
      <li><span>${t('Team handicap')} <small>${t('(by tier)')}</small></span><b>× ${score.handicap.toFixed(2)}</b></li></ul>
    ${proof && !already ? `<form class="score-submit" onsubmit="submitScore(event)"><input id="score-name" maxlength="24" placeholder="${t('Your name')}" value="${esc(name)}" required><button class="btn btn-primary btn-sm" type="submit">${t('Submit to leaderboard')}</button></form>`
      : `<p class="score-status">${already ? t('Submitted.') : t('Only fresh campaign runs can be submitted.')}</p>`}
    <p class="score-status" id="score-status"></p>`;
}
async function submitScore(ev: Event): Promise<void> {
  ev.preventDefault();
  const session = state.session;
  const proof = session?.runProof();
  const status = $('score-status');
  if (!session || !proof) { status.textContent = t('This run cannot be submitted.'); return; }
  const name = $<HTMLInputElement>('score-name').value.trim();
  if (!name) { status.textContent = t('Enter a name first.'); return; }
  try { localStorage.setItem(NAME_KEY, name); } catch { /* private mode */ }
  const btn = document.querySelector<HTMLButtonElement>('#score-card button');
  if (btn) btn.disabled = true;
  status.textContent = t('Verifying your run…');
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, proof, token: clientToken()})});
    const body = await res.json().catch(() => ({})) as {rank?: number; error?: string};
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    submittedFor = session.gauntletView().results.at(-1)?.battleId ?? null;
    status.textContent = t('Verified! You are #{rank} on the leaderboard.', {rank: body.rank ?? '?'});
    document.querySelector('#score-card form')?.remove();
    void loadBoard();
  } catch (e) {
    status.textContent = t('Could not submit: {error}', {error: errorMessage(e)});
    if (btn) btn.disabled = false;
  }
}
interface BoardEntry { name: string; score: number; wins: number; battles: number; team: string[]; createdAt: string }
let boardEntries: BoardEntry[] | null = null;
function renderBoard(): void {
  const card = $('board-card');
  const entries = boardEntries;
  if (!entries) { card.classList.add('hidden'); return; }
  card.innerHTML = `<div class="panel-head"><h3>${t('Leaderboard')}</h3><span class="panel-note">${t('top {n} · verified runs', {n: entries.length})}</span></div>
    <ol class="board-list">${entries.map((e, i) => `<li><span class="rank">#${i + 1}</span><span>${esc(e.name)}<small>${t('{w}/{b} wins', {w: e.wins, b: e.battles})} · ${e.team.map((id) => monName({id, name: id})).join(', ')}</small></span><span class="score">${e.score}</span></li>`).join('') || `<li><span></span><span>${t('No runs yet. Be the first!')}</span><span></span></li>`}</ol>`;
  card.classList.remove('hidden');
}
async function loadBoard(): Promise<void> {
  const card = $('board-card');
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=10`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    boardEntries = (await res.json() as {entries: BoardEntry[]}).entries;
    renderBoard();
  } catch {
    card.classList.add('hidden'); // no API here (local build, or the function is not configured)
  }
}

/* =====================================================================
   POOL / POKÉDEX MATRIX
   ===================================================================== */
function renderMatrix(): void {
  const m = state.matrix!; const grid = $('matrix');
  grid.innerHTML = `<div class="mhead">${t('Type')}</div>` + m.generations.map((g) => `<div class="mhead">G${g}</div>`).join('');
  for (const type of m.types) {
    grid.insertAdjacentHTML('beforeend', `<div class="mhead type t-${type.toLowerCase()}">${typeName(type)}</div>`);
    for (const gen of m.generations) {
      const cell = m.cells.find((c) => c.type === type && c.generation === gen)!;
      const btn = document.createElement('button');
      btn.className = `mcell ${cell.state}`;
      btn.innerHTML = `${cell.eligibleCount}<small>${cell.state === 'normal' ? '' : t(cell.state)}</small>`;
      btn.onclick = () => renderCell(cell, btn);
      grid.appendChild(btn);
    }
  }
  $('matrix-summary').textContent = t('{n} included cells · {m} draftable Pokémon', {n: m.includedCellCount, m: m.atomCount});
}
function renderCell(cell: MatrixCellView, btn: HTMLElement): void {
  document.querySelectorAll('.mcell').forEach((c) => c.classList.remove('selected'));
  btn.classList.add('selected');
  const d = $('detail');
  const list = cell.pokemon.length
    ? `<ul class="dlist">${cell.pokemon.map((p) => `<li><span class="mini">${sprite(p)}</span>
         <span><strong>${monName(p)}</strong><div class="meta">${t('Gen {g} · BST {b}', {g: p.debutGeneration, b: p.baseStatTotal})}</div>
         <div class="chips" style="justify-content:flex-start;margin-top:.2rem">${typeChips(p)}</div></span></li>`).join('')}</ul>`
    : `<p style="color:var(--muted)">${t('No active-source Pokémon occupy this cell.')}</p>`;
  d.innerHTML = `<h3>${typeName(cell.type)} · ${t('Gen {n}', {n: cell.generation})}</h3>
    <p style="color:var(--muted);font-size:.88rem">${t('{n} eligible', {n: `<b style="color:var(--ink)">${cell.eligibleCount}</b>`})} · ${
      cell.state === 'excluded' ? t('excluded from rolls') : cell.state === 'thin' ? t('thin — free reroll') : t('included')}</p>${list}`;
  fixImages(d);
}

/* =====================================================================
   BOOT
   ===================================================================== */
// The markup uses inline onclick handlers (carried over from v1), so the
// handlers it names are published on window.
Object.assign(window, {go, togglePool, jumpToReplay, newRun, pick, skip, thinReroll, copyExport, chooseSet, editBoss, discardBoss, resetBossForm, startRun, startCampaign, battleOne, rollMon, setLowPower, submitScore, setLanguage});
declare global { interface Window { __rollmons: {view: () => SessionView | null; screen: () => string; ready: Promise<string>} } }

$('boss-form').addEventListener('submit', saveBoss);

async function boot(): Promise<void> {
  initLang(params.get('lang'));
  applyStatic(document);
  go('title');
  initRoller();
  $<HTMLInputElement>('low-power').checked = lowPower;
  $('title-foot').textContent = t('Loading game data…');
  try {
    const res = await fetch(new URL('./data/game-data.json', import.meta.url));
    if (!res.ok) throw new Error(`game data: HTTP ${res.status}`);
    const data = (await res.json()) as GameData;
    state.ctx = createGameContext(data);
    state.bossBook = new BossBook(state.ctx);
    state.matrix = matrixView(state.ctx);
    renderMatrix();
    renderBosses(state.bossBook.list());
    $('title-foot').textContent = t('Lv 100 · Gen 9 · engine-enforced dedupe');
    void loadBoard();
  } catch (e) {
    $('matrix-summary').textContent = errorMessage(e);
    $('title-foot').textContent = t('Could not load game data: {error}', {error: errorMessage(e)});
  }
}

window.__rollmons = {view: () => state.view, screen: () => currentScreen, ready: battles.ready()};
boot();
