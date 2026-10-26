// The game page: port of v1's web_static/app.js with the FastAPI session
// replaced by GameSession (in-page) and battles run in the Web Worker.
// Screens, markup, and styles are carried over from v1.
import {BattleClient} from '../battle/client.ts';
import {DEFAULT_BUDGET_MS} from '../battle/runner.ts';
import {CAMPAIGN_STRUCTURE} from '../game/pool.ts';
import {BAND_POINTS, SPEED_BONUS_MAX, SPEED_BONUS_TURNS, TIER_COST} from '../game/score.ts';
import type {GameData} from '../game/data.ts';
import {esc, mountLiveReplay, mountReplay, type LiveReplay} from '../replay/embed.ts';
import {type MatrixCellView, 
  BOSS_ORDER_MAX, BOSS_ORDER_MIN, BossBook, DraftError, GameSession, PLAYER_NAME, SessionError, createGameContext, matrixView, poolSpecies,
  type BattleResult, type BattleSpec, type BossInfo, type GameContext, type GauntletView, type MatrixView, type OfferView,
  type SessionView, type SpeciesView, speciesSetOptions} from './session.ts';
import {LEGENDARY, RARITY_NAMES} from '../game/legality-matrix.ts';
import type {SelectableSet} from '../game/team-assembly.ts';
import {isDevAccount} from '../game/dev-accounts.ts';
import {initRoller, rollMon, setRollerPool} from './roller.ts';
import {applyStatic, initLang, lang, localSpeciesName, setLang, t, type Lang} from './i18n.ts';
import {CHANGELOG} from './changelog.ts';

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
// Any https host is the hosted site (rollmon.gg, the vercel.app names): same-origin API, accounts on.
const API_BASE = params.get('api') ?? (location.protocol === 'https:' ? '' : 'https://rollmon.gg');
const AUTH_ENABLED = API_BASE === '';
/** The boss-ladder page is a developer tool: players go from the loadout straight into the campaign. Open for the author's accounts (and locally, where there are no accounts). */
const isDeveloper = () => !AUTH_ENABLED || isDevAccount(account?.name);
// Vercel Web Analytics (page views, no cookies). The script is served by the
// deployment only, so a local build does not request it.
if (location.protocol === 'https:') {
  const s = document.createElement('script');
  s.defer = true; s.src = '/_vercel/insights/script.js';
  document.head.append(s);
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
  initRoller(typeName);
  feedRoller();
  renderPool();
  renderBoard();
  renderAccount();
  renderHelp();
  renderNews();
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
  if (name === 'title') $('corner').append($('tools')); else $('topbar').insertBefore($('tools'), $('dev-btn'));
  if (name === 'bosses' && !isDeveloper()) { go('loadout'); return; }
  $('corner').classList.toggle('hidden', name !== 'title');
  if (!$('board-drawer').classList.contains('hidden')) toggleBoard();
  if (!$('menu-drawer').classList.contains('hidden')) toggleMenu();
  if (!$('help-drawer').classList.contains('hidden')) toggleHelp();
  if (!$('news-drawer').classList.contains('hidden')) toggleNews();
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
  const order: Record<string, number> = {draft: 0, loadout: 1, bosses: 1, battle: 2, results: 3};
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
const draftUi: {round: number; selected: string; set: number; enter: boolean} = {round: 0, selected: '', set: 0, enter: false};
function renderDraft(draft: SessionView): void {
  $('draft-status').textContent = '';
  state.teamExport = draft.complete ? (draft.teamExport || '') : '';
  $<HTMLButtonElement>('copy-export').disabled = !state.teamExport;
  renderPartyStrip(draft);
  const live = $('draft-live');
  // a complete draft has no draft screen left: draftAction moves on to the loadout
  live.classList.toggle('hidden', draft.complete);
  if (draft.complete) return;
  const offer = draft.offer!;
  // a new offer highlights its first candidate; a re-render keeps the player's choice
  if (offer.roundNumber !== draftUi.round || !offer.candidates.some((c) => c.id === draftUi.selected)) {
    draftUi.round = offer.roundNumber; draftUi.selected = offer.candidates[0]?.id ?? ''; draftUi.set = 0;
  }
  $('encounter').classList.remove('enter'); $('cand-detail').classList.remove('enter', 'swap');
  renderEncounter(draft);
  renderCandidates(offer);
  renderCandidateDetail(offer);
  if (draftUi.enter) {
    draftUi.enter = false;
    $('encounter').classList.add('enter');
    document.querySelectorAll<HTMLElement>('#candidates .cand').forEach((el, i) => { el.classList.add('enter'); el.style.animationDelay = `${i * 70}ms`; });
    $('cand-detail').classList.add('enter');
    document.querySelector('#party .pslot.filled:last-of-type')?.classList.add('land');
  }
}
function renderEncounter(draft: SessionView): void {
  const o = draft.offer!;
  const totalSkips = draft.draftConfig.manualSkipCount;
  $('encounter').innerHTML = `
    <div>
      <p class="eyebrow" style="margin:0 0 .25rem">${t('Wild cell')} · ${t('Round {n} of 6', {n: o.roundNumber})}</p>
      <div class="cell-name"><span style="color:${typeColor(o.cell.type)}">${typeName(o.cell.type)}</span> · ${t('Gen {n}', {n: o.cell.generation})}</div>
      <p class="odds-note">${t('Slot odds — Poké Ball {c}% · Great Ball {u}% · Ultra Ball {r}% · Master Ball {l}%', {c: o.rarityOdds[0], u: o.rarityOdds[1], r: o.rarityOdds[2], l: o.rarityOdds[3]})}</p>
      ${o.nativeCount < o.thinCellThreshold ? `<p class="thin-note">${t('Thin cell — only {n} from this generation; the rest are visitors from nearby generations.', {n: o.nativeCount})}</p>` : ''}
    </div>
    <div class="encounter-actions">
      <button class="btn btn-ghost btn-sm" id="start-over" onclick="startOver()">${t('Start over')}</button>
      <button class="btn btn-ghost btn-sm" onclick="skip()" ${draft.skipsRemaining ? '' : 'disabled'}>
        ${t('Skip cell ({a}/{b})', {a: draft.skipsRemaining, b: totalSkips})}
      </button>
    </div>`;
}
/** The five candidates as tiles; the highlighted one is detailed below. */
function renderCandidates(offer: OfferView): void {
  const root = $('candidates');
  root.innerHTML = offer.candidates.map((p) => `
    <button class="cand${p.id === draftUi.selected ? ' on' : ''}${p.visitor ? ' visitor' : ''}" data-id="${p.id}" onclick="draftSelect('${p.id}')" title="${esc(monName(p))}">
      <span class="cand-sprite"><img class="asset" src="${p.pixelSpriteUrl}" alt=""></span>
      <span class="cand-name">${monName(p)}</span>
      <span class="rarity r${p.rarity}"><span class="stars">${starsOf(p)}</span><span>${t(RARITY_LABELS[p.rarityName])}</span></span>
      <span class="chips">${typeChips(p)}</span>
    </button>`).join('');
  fixImages(root);
}
/** The highlighted candidate: species block, every set it can run, and the Pick button (the open set goes to the loadout). */
function renderCandidateDetail(offer: OfferView): void {
  const root = $('cand-detail');
  const p = offer.candidates.find((c) => c.id === draftUi.selected) ?? offer.candidates[0];
  if (!p) { root.innerHTML = ''; return; }
  const sets = speciesSetOptions(state.ctx!, p.id);
  const open = Math.min(draftUi.set, Math.max(0, sets.length - 1));
  root.innerHTML = `
    <div class="cand-info">${speciesBlock(p, {label: t('Generation'), value: t('Gen {n}', {n: p.debutGeneration})})}</div>
    <div class="cand-sets">
      ${setBlock(p, sets, open, 'draftSet')}
      <button class="btn btn-primary btn-lg pick" onclick="pick('${p.id}','${sets[open]?.setId ?? ''}')">${t('Pick {name}', {name: monName(p)})}</button>
    </div>`;
  fixImages(root);
}
function draftSelect(id: string): void {
  const offer = state.view?.offer;
  if (!offer) return;
  if (id === draftUi.selected) return;
  draftUi.selected = id; draftUi.set = 0;
  renderCandidates(offer); renderCandidateDetail(offer);
  if (!reducedMotion()) $('cand-detail').classList.add('swap');
}
function draftSet(index: number): void {
  const offer = state.view?.offer;
  if (!offer) return;
  draftUi.set = index;
  renderCandidateDetail(offer);
}
/** Six small slots in the page head: filled left to right, the current round's slot pulsing. */
function renderPartyStrip(draft: SessionView): void {
  const root = $('party');
  const n = draft.team.length;
  root.innerHTML = Array.from({length: 6}, (_, i) => {
    const p = draft.team[i];
    if (p) return `<li class="pslot filled" title="${esc(monName(p))}"><img class="asset" src="${p.pixelSpriteUrl}" alt=""></li>`;
    return `<li class="pslot empty${i === n && !draft.complete ? ' current' : ''}"><span class="pokeball ball"></span></li>`;
  }).join('');
  $('party-count').textContent = draft.complete ? t('Complete') : t('{n} / 6 drafted', {n});
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
  try {
    action();
    const view = refreshView();
    renderDraft(view);
    if (view.complete) go('loadout');
  } catch (e) {
    if (e instanceof DraftError || e instanceof SessionError) $('draft-status').textContent = e.message;
    else throw e;
  }
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let draftBusy = false;
/** Pick (or skip) with a transition: the tiles drop away one after another, then the next cell slides in. */
async function draftTransition(action: () => void): Promise<void> {
  if (draftBusy) return;
  if (reducedMotion()) { draftAction(action); return; }
  draftBusy = true;
  try {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('#candidates .cand'));
    const runs = tiles.map((el, i) => el.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(26px) scale(.85)'}],
      {duration: 260, delay: i * 40, easing: 'ease-in', fill: 'forwards'}));
    // the panel element survives the re-render, so its fade must not keep filling forwards afterwards
    const fade = $('cand-detail').animate([{opacity: 1}, {opacity: 0}], {duration: 220, fill: 'forwards'});
    await Promise.all([...runs, fade].map((a) => a.finished));
    fade.cancel();
    draftUi.enter = true;
    draftAction(action);
  } finally { draftBusy = false; }
}
function pick(id: string, setId = ''): void { void draftTransition(() => state.session!.pick(id, setId || undefined)); }
function skip(): void { void draftTransition(() => state.session!.skip()); }
/** In-page yes/no box in the game's style (the browser's confirm() looked foreign); Esc counts as no. */
function askConfirm(message: string, yes: string): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('confirm-dialog');
  $('confirm-text').textContent = message;
  $('confirm-yes').textContent = yes;
  dlg.showModal();
  return new Promise((resolve) => {
    const done = (v: boolean) => { dlg.close(); resolve(v); };
    $('confirm-yes').onclick = () => done(true);
    $('confirm-no').onclick = () => done(false);
    dlg.oncancel = (e) => { e.preventDefault(); done(false); };
  });
}
/** Discard the draft in progress and roll a new run (a reload did the same; this makes it honest). A `?seed=` URL repeats the seed. */
async function startOver(): Promise<void> {
  if (!(await askConfirm(t('Discard this draft and start a new run?'), t('Start over')))) return;
  if (draftBusy || reducedMotion()) { newRun(); return; }
  // the whole draft leaves: drafted party slots shrink away first, then the cell header, the tiles and the detail
  // panel drop out in sequence; the new run then plays the usual enter animation
  draftBusy = true;
  try {
    const party = Array.from(document.querySelectorAll<HTMLElement>('#party .pslot.filled'));
    const rest = [$('encounter'), ...Array.from(document.querySelectorAll<HTMLElement>('#candidates .cand')), $('cand-detail')];
    const runs = [
      ...party.map((el, i) => el.animate([{transform: 'none', opacity: 1}, {transform: 'scale(.3) rotate(-20deg)', opacity: 0}], {duration: 280, delay: i * 50, easing: 'ease-in', fill: 'forwards'})),
      ...rest.map((el, i) => el.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(34px) scale(.9)'}], {duration: 300, delay: 120 + i * 45, easing: 'ease-in', fill: 'forwards'})),
    ];
    await Promise.all(runs.map((a) => a.finished));
    runs.forEach((a) => a.cancel()); // #encounter, #cand-detail and the slot list survive the re-render: do not leave them hidden
    draftUi.enter = true;
    newRun();
  } finally { draftBusy = false; }
}

async function copyExport(): Promise<void> {
  if (!state.teamExport) return;
  try {
    await navigator.clipboard.writeText(state.teamExport);
    document.querySelectorAll<HTMLButtonElement>('.copy-export').forEach((b) => { const was = b.textContent; b.textContent = t('Copied ✓'); setTimeout(() => { b.textContent = was; }, 1200); });
  } catch { /* clipboard unavailable */ }
}

/* =====================================================================
   LOADOUT  (choose one set per drafted Pokémon; Mega is opt-in)
   ===================================================================== */
interface PasteSet { export?: string | null; item?: string; ability?: string; moves?: string[] }
function pokepaste(name: string, set: PasteSet | null, spread: SpeciesView['assemblySpread'] | null): string {
  if (set && set.export) return set.export;
  const lines = [`${titleCase(name)}${set && set.item ? ` @ ${displayName(set.item)}` : ''}`];
  if (set && set.ability) lines.push(`Ability: ${displayName(set.ability)}`);
  if (spread) {
    lines.push(`Level: ${spread.level}`);
    const ev = Object.entries(spread.evs).map(([k, v]) => `${v} ${k}`).join(' / ');
    if (ev) lines.push(`EVs: ${ev}`);
    if (spread.nature) lines.push(`${spread.nature} Nature`);
  }
  (set?.moves ?? []).forEach((m) => lines.push(`- ${titleCase(m)}`));
  return lines.join('\n');
}

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
  $('run-end').classList.toggle('hidden', !ready);
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
      <li><span>${t('Team handicap')} <small>${t('(by tier)')}</small></span><b>× ${score.handicap.toFixed(2)}</b></li>
      <li><span>${t('Turns')} <small>${t('(tiebreak, fewer first)')}</small></span><b>${score.turns}</b></li></ul>
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
  // a row: rank, name (the signed-in player's row highlighted), the team as pixel sprites named on hover, record, points
  const byId = new Map((state.pool ?? []).map((p) => [p.id, p]));
  const member = (id: string) => {
    const p = byId.get(id);
    const name = monName({id, name: state.ctx?.legality.species[id]?.name ?? id});
    return p ? `<img class="asset" src="${p.pixelSpriteUrl}" alt="${esc(name)}" title="${esc(name)}" loading="lazy">` : `<span class="board-noicon" title="${esc(name)}"></span>`;
  };
  const rows = entries.map((e, i) => `<li${account && e.name === account.name ? ' class="me"' : ''}><span class="rank">#${i + 1}</span>
      <span class="board-who"><span class="board-name">${esc(e.name)}</span><span class="board-team">${e.team.map(member).join('')}</span><small>${t('{w}/{b} wins', {w: e.wins, b: e.battles})}</small></span>
      <span class="score">${e.score}</span></li>`);
  // the board is cut at boardLimit rows; when it is full there may be more, so offer the next size (the API caps at 100)
  const more = entries.length >= boardLimit && boardLimit < 100 ? `<p class="board-more"><button class="btn btn-ghost btn-sm" onclick="moreBoard()">${t('Show top {n}', {n: Math.min(100, boardLimit * 5)})}</button></p>` : '';
  $('board-card').innerHTML = `<p class="panel-note">${t('top {n} · best run per player', {n: entries.length})}</p>
    <ol class="board-list">${rows.join('') || `<li><span></span><span>${t('No runs yet. Be the first!')}</span><span></span></li>`}</ol>${more}`;
}
let boardLimit = 10;
function moreBoard(): void { boardLimit = Math.min(100, boardLimit * 5); void loadBoard(); }
async function loadBoard(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=${boardLimit}`);
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

/* ---- How it works drawer (title screen and ☰ menu): the rules in four sections, with the live numbers
   read from the draft config, the campaign structure, the score constants and the search budgets, so the text cannot go stale */
function renderHelp(): void {
  const body = $('help-body');
  const ctx = state.ctx;
  if (!ctx) { body.innerHTML = `<p class="help-sec">${t('Loading…')}</p>`; return; }
  const [c, u, r, l] = ctx.config.rarityOdds;
  const costs = Object.values(TIER_COST);
  const sec = (n: number, title: string, html: string) => `<section class="help-sec"><h4>${n} · ${title}</h4>${html}</section>`;
  const bands = CAMPAIGN_STRUCTURE.map(([tier, count]) => {
    const teams = Object.keys(ctx.data.pool[tier] ?? {}).length;
    return `<tr><td>${t(BAND_LABEL[tier] ?? tier)}</td><td class="n">${count}</td><td class="n">${teams > count ? teams : t('fixed')}</td><td class="n">${BAND_POINTS[tier] ?? 0}</td></tr>`;
  }).join('');
  body.innerHTML =
    sec(1, t('Draft'), `<p>${t('Six rounds. Each round rolls a cell: a type and the generation its Pokémon debuted in. {n} candidates come from that cell; when it is short, visitors of the same type from the nearest generations fill the offer.', {n: ctx.config.candidateCap})}</p>
      <p>${t('Every slot rolls a rarity from the Showdown tier, so legendaries are rare but never banned:')}</p>
      <p class="help-odds">${t('Poké Ball {c}% · Great Ball {u}% · Ultra Ball {r}% · Master Ball {l}%', {c, u, r, l})}</p>
      <p>${t('The pool holds {n} fully evolved Pokémon with competitive sets. No duplicates; {k} skips reroll the cell; Start over begins a new draft.', {n: state.pool?.length ?? Object.keys(ctx.legality.species).length, k: ctx.config.manualSkipCount})}</p>`) +
    sec(2, t('Loadout'), `<p>${t('Pick one set per Pokémon: sets contributed by players and Smogon analysis sets. Mega Evolution is a set choice, and one Mega per team can evolve in a battle.')}</p>`) +
    sec(3, t('Gauntlet'), `<p>${t('Ten battles against hand-built boss teams, climbing band by band. Pool bands draw their teams at random, so every run differs:')}</p>
      <table class="help-bands"><thead><tr><th>${t('Band')}</th><th class="n">${t('Battles')}</th><th class="n">${t('Teams')}</th><th class="n">${t('Points per win')}</th></tr></thead><tbody>${bands}</tbody></table>
      <p>${t('Both sides are played by the same search AI (poke-engine) in your browser, with full knowledge of both teams: your side thinks {p1} ms per move, the boss {p2} ms. On a slow device the AI searches less, so it plays weaker, not slower. Level 100, Gen 9 rules, no Terastallization.', {p1: DEFAULT_BUDGET_MS.p1, p2: DEFAULT_BUDGET_MS.p2})}</p>`) +
    sec(4, t('Score'), `<p>${t('Only wins count. Each win is worth its band\'s points, up to {s}% more for a fast battle (under {turns} turns).', {s: Math.round(SPEED_BONUS_MAX * 100), turns: SPEED_BONUS_TURNS})}</p>
      <p>${t('The total is multiplied by a team handicap: the average tier cost of the six formes you played, from ×{lo} (Ubers) to ×{hi} (low tiers), so a cheap team is worth about one extra level.', {lo: Math.min(...costs), hi: Math.max(...costs)})}</p>
      <p>${t('The leaderboard keeps each player\'s best run. The server replays the whole run in the simulator before accepting a score.')}</p>`);
}
/* ---- What's new drawer: dated, player-facing notes from changelog.ts, newest first;
   opens on the newest three, the rest behind "Show older updates" */
const NEWS_PAGE = 3;
let newsLimit = NEWS_PAGE;
function renderNews(): void {
  const shown = CHANGELOG.slice(0, newsLimit);
  const more = CHANGELOG.length - shown.length;
  $('news-body').innerHTML = shown.map((e) => `<section class="news-entry"><h4>${e.date}</h4><ul>${e.bullets[lang()].map((b) => `<li>${esc(b)}</li>`).join('')}</ul></section>`).join('')
    + (more > 0 ? `<p class="news-more"><button class="btn btn-ghost btn-sm" onclick="moreNews()">${t('Show older updates ({n})', {n: more})}</button></p>` : '');
}
function moreNews(): void { newsLimit = CHANGELOG.length; renderNews(); }
function toggleNews(): void {
  const open = $('news-drawer').classList.contains('hidden');
  if (open) { newsLimit = NEWS_PAGE; renderNews(); }
  $('news-drawer').classList.toggle('hidden', !open);
  $('news-backdrop').classList.toggle('hidden', !open);
}
function toggleHelp(): void {
  const open = $('help-drawer').classList.contains('hidden');
  if (open) renderHelp();
  $('help-drawer').classList.toggle('hidden', !open);
  $('help-backdrop').classList.toggle('hidden', !open);
}

/* ---- feedback drawer, three tabs: free text, a set contribution for one species (picked from the pool), or a boss team (docs/ROADMAP.md §7) */
type FeedbackKind = 'feedback' | 'set' | 'boss';
let feedbackKind: FeedbackKind = 'feedback';
let feedbackSpecies = '';
/** The draftable species whose name in the current language, English name or id is the typed text. */
function resolveFeedbackSpecies(typed: string): SpeciesView | undefined {
  const key = typed.trim().toLowerCase();
  return key ? state.pool?.find((p) => p.id === key || monName(p).toLowerCase() === key || titleCase(p.name).toLowerCase() === key) : undefined;
}
/** Up to eight pool species whose name (page language or English) contains the typed text, prefix matches first. */
function renderSpeciesSuggestions(typed: string): void {
  const key = typed.trim().toLowerCase();
  const names = (p: SpeciesView) => [monName(p).toLowerCase(), titleCase(p.name).toLowerCase()];
  const hits = key ? (state.pool ?? []).filter((p) => names(p).some((n) => n.includes(key))) : [];
  hits.sort((a, b) => Number(names(b).some((n) => n.startsWith(key))) - Number(names(a).some((n) => n.startsWith(key))));
  const box = $('feedback-species-suggest');
  box.innerHTML = hits.slice(0, 8).map((p) => `<button type="button" class="suggest-item" onclick="pickFeedbackSpecies('${p.id}')"><img class="asset" src="${p.pixelSpriteUrl}" alt="">${esc(monName(p))}${lang() === 'en' ? '' : ` <span class="muted">${esc(titleCase(p.name))}</span>`}</button>`).join('');
  box.classList.toggle('hidden', !hits.length);
}
function pickFeedbackSpecies(id: string): void {
  const view = state.pool?.find((p) => p.id === id);
  $<HTMLInputElement>('feedback-species').value = view ? monName(view) : '';
  feedbackSpeciesChanged();
}
/** Title, hint and export placeholder of the set tab follow the species in the picker. */
function feedbackSpeciesChanged(): void {
  const typed = $<HTMLInputElement>('feedback-species').value;
  const view = resolveFeedbackSpecies(typed);
  renderSpeciesSuggestions(view ? '' : typed);
  feedbackSpecies = view?.id ?? '';
  const name = view ? monName(view) : '';
  $('feedback-title').textContent = view ? t('Contribute a set: {name}', {name}) : t('Contribute a set');
  $('feedback-hint').textContent = view
    ? t('Paste one or more Showdown export blocks for {name}. A nickname becomes the set\'s label.', {name})
    : t('Pick the Pokémon, then paste one or more Showdown export blocks for it. A nickname becomes the set\'s label.');
  $<HTMLTextAreaElement>('feedback-text').placeholder = `${view ? titleCase(view.name) : 'Garchomp'} @ Leftovers\nAbility: …\nEVs: 252 HP / 252 Atk / 4 Spe\nAdamant Nature\n- …\n- …\n- …\n- …`;
}
function feedbackTab(kind: FeedbackKind): void { openFeedback(kind, kind === 'set' ? feedbackSpecies : '', false); }
/** `focus`: move the caret into the first field; not on tab switches, and never on touch devices (iOS animates the keyboard on each focus). */
function openFeedback(kind: FeedbackKind = 'feedback', speciesId = '', focus = true): void {
  feedbackKind = kind; feedbackSpecies = speciesId;
  document.querySelectorAll<HTMLElement>('#feedback-tabs .drawer-tab').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  $('feedback-title').textContent = kind === 'boss' ? t('Contribute a boss') : t('Feedback');
  $('feedback-hint').textContent = kind === 'boss'
    ? t('Paste a full team of six as a Showdown export, name the boss, and say which ladder level (1–10) it fits and why.')
    : t('What broke, or what would you change? The screen and language you are on are sent along.');
  const ta = $<HTMLTextAreaElement>('feedback-text');
  ta.value = '';
  ta.placeholder = kind === 'boss' ? `Tyranitar @ Tyranitarite\nAbility: Sand Stream\nEVs: 252 Atk / 4 Def / 252 Spe\nJolly Nature\n- …\n- …\n- …\n- …\n\nExcadrill @ Leftovers\n…\n\n(six Pokémon)` : '';
  // a set names its species: a text field with suggestions from the draftable pool in the current language,
  // prefilled when opened from the pool's species panel
  $('feedback-species-field').classList.toggle('hidden', kind !== 'set');
  $('feedback-species-suggest').classList.add('hidden');
  const species = $<HTMLInputElement>('feedback-species');
  species.required = kind === 'set'; species.placeholder = t('Type a Pokémon name');
  if (kind === 'set') {
    const view = state.pool?.find((p) => p.id === speciesId);
    species.value = view ? monName(view) : '';
    feedbackSpeciesChanged();
  }
  // a boss has a name; a set comes with a one-line summary, a boss with the level it fits
  $('feedback-name-field').classList.toggle('hidden', kind !== 'boss');
  const bossName = $<HTMLInputElement>('feedback-name');
  bossName.value = ''; bossName.required = kind === 'boss'; bossName.placeholder = kind === 'boss' ? t('e.g. Sand') : '';
  $('feedback-note-field').classList.toggle('hidden', kind === 'feedback');
  $('feedback-note-label').textContent = kind === 'boss' ? t('Fits level') : t('Summary');
  const note = $<HTMLInputElement>('feedback-note');
  note.value = ''; note.required = kind !== 'feedback';
  note.placeholder = kind === 'set' ? t('What the set does, e.g. Scarf attacker, defensive pivot')
    : kind === 'boss' ? t('Which level and why, e.g. Level 7: sand offense') : '';
  $('feedback-error').textContent = '';
  $('feedback-status').textContent = AUTH_ENABLED ? '' : t('Feedback can only be sent from the hosted site.');
  $<HTMLButtonElement>('feedback-send').disabled = !AUTH_ENABLED;
  $('feedback-drawer').classList.remove('hidden');
  $('feedback-backdrop').classList.remove('hidden');
  if (focus && !matchMedia('(pointer: coarse)').matches) { if (kind === 'set' && !feedbackSpecies) species.focus(); else ta.focus(); }
}
function closeFeedback(): void {
  $('feedback-drawer').classList.add('hidden');
  $('feedback-backdrop').classList.add('hidden');
}
async function submitFeedback(ev: Event): Promise<void> {
  ev.preventDefault();
  const btn = $<HTMLButtonElement>('feedback-send'), err = $('feedback-error'), status = $('feedback-status');
  if (feedbackKind === 'set') {
    feedbackSpecies = resolveFeedbackSpecies($<HTMLInputElement>('feedback-species').value)?.id ?? '';
    if (!feedbackSpecies) { err.textContent = t('Pick a Pokémon from the list'); $('feedback-species').focus(); return; }
  }
  btn.disabled = true; err.textContent = ''; status.textContent = t('Sending…');
  try {
    const payload = {
      kind: feedbackKind, species: feedbackSpecies || null, boss: feedbackKind === 'boss' ? $<HTMLInputElement>('feedback-name').value : null,
      note: feedbackKind === 'feedback' ? null : $<HTMLInputElement>('feedback-note').value,
      text: $<HTMLTextAreaElement>('feedback-text').value, screen: currentScreen, lang: lang(), seed: state.session?.seed ?? null,
    };
    const res = await fetch(`${API_BASE}/api/feedback`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
    const body = await res.json().catch(() => ({})) as {error?: string};
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    status.textContent = t('Thanks, received.');
    $<HTMLTextAreaElement>('feedback-text').value = '';
    $<HTMLInputElement>('feedback-note').value = '';
    $<HTMLInputElement>('feedback-name').value = '';
  } catch (e) {
    status.textContent = '';
    err.textContent = errorMessage(e);
  }
  btn.disabled = false;
}

/* ---- accounts (Showdown-style name + password; the session is a same-origin cookie) */
let account: {name: string} | null = null;
let authModeNow: 'login' | 'register' = 'login';
function renderAccount(): void {
  $('dev-btn').classList.toggle('hidden', !isDeveloper());
  const html = !AUTH_ENABLED ? '' : account
    ? `<span class="who" title="${esc(account.name)}">${esc(account.name)}</span><button class="btn btn-ghost btn-sm" id="signout-btn" onclick="logout()">${t('Sign out')}</button>`
    : `<button class="btn btn-ghost btn-sm" id="signin-btn" onclick="openAuth('login')">${t('Sign in')}</button>`;
  $('account').innerHTML = html;
  try { if (account) localStorage.setItem('rollmons-account', account.name); else localStorage.removeItem('rollmons-account'); } catch { /* private mode */ }
  // the phone menu shows the same chip (without the ids, which the strip's copy owns)
  $('menu-account').innerHTML = html.replace(/ id="[^"]*"/g, '').replace(/onclick="/g, 'onclick="toggleMenu(); ');
}
function toggleMenu(): void {
  const open = $('menu-drawer').classList.contains('hidden');
  $('menu-drawer').classList.toggle('hidden', !open);
  $('menu-backdrop').classList.toggle('hidden', !open);
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
// The 18×9 Type × Gen matrix of v1 is the whole navigation: a cell click
// lists the cell's natives in the left panel, a sprite click shows the
// species. The Rarity tabs change the matrix counts and dim the other balls.
const POOL_TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const poolUi: {rarity: number; type: string; gen: number; selected: string; set: number} = {rarity: -1, type: '', gen: 0, selected: '', set: 0};

function poolFilter(rarity: number): void { poolUi.rarity = rarity; renderPool(); }
function poolSelect(id: string): void { if (id !== poolUi.selected) poolUi.set = 0; poolUi.selected = id; renderPool(); }
/** Open one of the selected species' sets. */
function poolSet(index: number): void { poolUi.set = index; renderPool(); }
function poolCell(type: string, gen: number): void {
  poolUi.type = type; poolUi.gen = gen;
  const cell = poolCellView();
  if (cell && !cell.pokemon.some((p) => p.id === poolUi.selected)) poolUi.selected = cellMons(cell)[0]?.id ?? '';
  renderPool();
  // one column (phone): the panel sits under the matrix, bring it up
  if (window.innerWidth <= 900) $('pool-detail').scrollIntoView({behavior: 'smooth', block: 'start'});
}
function poolCellView(): MatrixCellView | null {
  return state.matrix?.cells.find((c) => c.type === poolUi.type && c.generation === poolUi.gen) ?? null;
}
/** A cell's natives, best ball first, then dex order. */
function cellMons(cell: MatrixCellView): SpeciesView[] {
  return [...cell.pokemon].sort((a, b) => b.rarity - a.rarity || a.dexNumber - b.dexNumber || a.id.localeCompare(b.id));
}

function renderPool(): void {
  if (!state.pool || !state.matrix) return;
  // landing: a random cell with a full offer, so the panel is never empty
  if (!poolCellView()) {
    const full = state.matrix.cells.filter((c) => c.state === 'normal');
    const c = full[Math.floor(Math.random() * full.length)];
    poolUi.type = c.type; poolUi.gen = c.generation; poolUi.selected = cellMons(c)[0]?.id ?? '';
  }
  const tab = (on: boolean, onclick: string, label: string) => `<button class="ftab${on ? ' on' : ''}" onclick="${onclick}">${label}</button>`;
  $('pool-rarity').innerHTML = `<span class="flabel">${t('Rarity')}</span>${tab(poolUi.rarity < 0, 'poolFilter(-1)', t('All'))}${RARITY_NAMES.map((name, r) => tab(poolUi.rarity === r, `poolFilter(${r})`, t(RARITY_LABELS[name]))).join('')}`;
  const cells = state.matrix.cells.filter((c) => c.eligibleCount);
  const n = poolUi.rarity < 0 ? state.pool.length : state.pool.filter((p) => p.rarity === poolUi.rarity).length;
  $('pool-summary').textContent = `${t('{n} of {m} draftable Pokémon', {n, m: state.pool.length})} · ${t('{n} cells, {m} thin', {n: cells.length, m: cells.filter((c) => c.state === 'thin').length})}`;
  renderPoolMatrix();
  renderPoolPanel();
}

/** The Type × Gen table: natives per cell (of the chosen ball when one is filtered), thin cells dimmed, a star where a Master Ball native lives. */
function renderPoolMatrix(): void {
  const gens = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const head = `<div class="mhead"></div>${gens.map((g) => `<div class="mhead${poolUi.gen === g ? ' on' : ''}">${g}</div>`).join('')}`;
  const rows = POOL_TYPES.map((type) => {
    const label = `<div class="mtype${poolUi.type === type ? ' on' : ''}"><span class="dot" style="--tc:${typeColor(type)}"></span>${typeName(type)}</div>`;
    const cells = gens.map((g) => {
      const cell = state.matrix!.cells.find((c) => c.type === type && c.generation === g)!;
      if (!cell.eligibleCount) return '<div class="mcell none">·</div>';
      const n = poolUi.rarity < 0 ? cell.eligibleCount : cell.pokemon.filter((p) => p.rarity === poolUi.rarity).length;
      const on = poolUi.type === type && poolUi.gen === g;
      const cls = `mcell${cell.state === 'thin' ? ' thin' : ''}${on ? ' on' : ''}${n ? '' : ' zero'}`;
      // the Master Ball marker only when the counts are not already filtered to another ball
      const star = (poolUi.rarity < 0 || poolUi.rarity === LEGENDARY) && cell.pokemon.some((p) => p.rarity === LEGENDARY) ? '<span class="mstar">★</span>' : '';
      return `<button class="${cls}" title="${esc(typeName(type))} · ${t('Gen {n}', {n: g})}: ${t('{n} natives', {n: cell.eligibleCount})}" onclick="poolCell('${type}',${g})">${n}${star}</button>`;
    }).join('');
    return label + cells;
  }).join('');
  $('pool-matrix').innerHTML = head + rows;
}

/** Left panel: the chosen cell's natives as a sprite strip, then the chosen species. */
function renderPoolPanel(): void {
  const d = $('pool-detail');
  const cell = poolCellView();
  if (!cell) { d.innerHTML = `<p class="pool-empty">${t('Click a cell to see its Pokémon.')}</p>`; return; }
  const mons = cellMons(cell);
  const p = mons.find((m) => m.id === poolUi.selected) ?? mons[0] ?? null;
  const strip = mons.map((m) => `<button class="pmon${m.id === p?.id ? ' sel' : ''}${poolUi.rarity >= 0 && m.rarity !== poolUi.rarity ? ' off' : ''}" title="${esc(monName(m))}" onclick="poolSelect('${m.id}')">
    <img class="asset" src="${m.pixelSpriteUrl}" alt=""><span class="cost r${m.rarity}">${m.rarity + 1}</span></button>`).join('');
  d.innerHTML = `
    <div class="cell-head">
      <span class="ptype t-${cell.type}">${typeName(cell.type)}</span>
      <span class="cell-gen">${t('Gen {n}', {n: cell.generation})}</span>
      <span class="cell-n">${t('{n} natives', {n: cell.eligibleCount})}${cell.state === 'thin' ? ` · ${t('thin')}` : ''}</span>
    </div>
    <div class="cell-mons">${strip}</div>
    ${p ? speciesDetail(p) : ''}`;
  fixImages(d);
}

const moveData = (move: string) => state.ctx!.data.moves[move.toLowerCase().replace(/[^a-z0-9]/g, '')] as {type?: string; name?: string} | undefined;
const moveType = (move: string) => String(moveData(move)?.type ?? 'normal').toLowerCase();
const moveName = (move: string) => moveData(move)?.name ?? titleCase(move);
const starsOf = (p: {rarity: number}) => '★'.repeat(p.rarity + 1) + '☆'.repeat(3 - p.rarity);

/** Sprite, dex number, name, types, then rarity / tier / BST rows and one more (the pool's cells, the draft's generation). Shared by the pool panel and the draft panel. */
function speciesBlock(p: SpeciesView, extra: {label: string; value: string}): string {
  return `
    <div class="pool-art">
      <div class="pool-sprite"><img class="asset" src="${p.pixelSpriteUrl}" alt=""></div>
      <div class="pool-id">
        <div class="pool-dex">No ${String(p.dexNumber).padStart(4, '0')}</div>
        <h2 class="pool-name">${monName(p)}</h2>
        <div class="pool-types">${p.types.map((x) => `<span class="ptype t-${x}">${typeName(x)}</span>`).join('')}</div>
      </div>
    </div>
    <dl class="pool-rows">
      <div><dt>${t('Rarity')}</dt><dd class="r${p.rarity}">${starsOf(p)} ${t(RARITY_LABELS[p.rarityName])}</dd></div>
      <div><dt>${t('Tier')}</dt><dd>${p.tier ? esc(p.tier) : '—'}</dd></div>
      <div><dt>${t('BST')}</dt><dd>${p.baseStatTotal}</dd></div>
      <div><dt>${extra.label}</dt><dd>${extra.value}</dd></div>
    </dl>`;
}
/** Set tabs (override sets first, then the source's) and the open set's item, ability and type-coloured moves; a tab calls the window function `onTab(index)`. */
function setBlock(p: {id: string}, sets: SelectableSet[], open: number, onTab: string): string {
  const set = sets[open];
  if (!set) return '';
  return `
    <div class="pool-set">
      <div class="pool-set-head"><span>${t('{n} sets', {n: sets.length})}</span><button class="btn btn-ghost btn-sm contribute" onclick="openFeedback('set','${p.id}')">${t('Contribute a set')}</button></div>
      <ul class="pool-sets">${sets.map((o, i) => `<li><button class="stab${i === open ? ' on' : ''}" onclick="${onTab}(${i})">${esc(o.label)}${o.isMega ? ' ⚡' : ''}</button></li>`).join('')}</ul>
      <div class="pool-kv">${esc(set.item ? displayName(set.item) : '—')} · ${esc(displayName(set.ability))}</div>
      <ul class="pool-moves">${set.moves.map((mv) => `<li class="pmove t-${moveType(mv)}">${esc(moveName(mv))}</li>`).join('')}</ul>
    </div>`;
}
function speciesDetail(p: SpeciesView): string {
  // the other cells this species lives in are one click away
  const cells = p.types.map((x) => {
    const cell = state.matrix!.cells.find((c) => c.type === x && c.generation === p.debutGeneration);
    const label = `${typeName(x)} ${cell?.eligibleCount ?? 0}`;
    return x === poolUi.type ? `<span>${label}</span>` : `<button class="cell-link" onclick="poolCell('${x}',${p.debutGeneration})">${label}</button>`;
  }).join(' · ');
  const sets = speciesSetOptions(state.ctx!, p.id);
  const open = Math.min(poolUi.set, Math.max(0, sets.length - 1));
  return speciesBlock(p, {label: t('Cells'), value: cells}) + setBlock(p, sets, open, 'poolSet');
}

let nameIndex: Map<string, string> | null = null;
/** Display name of an item or ability id (override sets carry ids): read off the Smogon exports and the pokedex, title case as the fallback. */
function displayName(id: string): string {
  const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!nameIndex && state.ctx) {
    nameIndex = new Map();
    const add = (name: string) => nameIndex!.set(key(name), name.trim());
    for (const sets of Object.values(state.ctx.smogon)) for (const s of sets) {
      const item = /^.* @ (.+)$/m.exec(s.export)?.[1]; if (item) add(item);
      const ability = /^Ability: (.+)$/m.exec(s.export)?.[1]; if (ability) add(ability);
    }
    for (const entry of Object.values(state.ctx.data.pokedex)) for (const a of Object.values((entry as {abilities?: Record<string, string>}).abilities ?? {})) add(a);
  }
  return nameIndex?.get(key(id)) ?? titleCase(id);
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
Object.assign(window, {go, togglePool, jumpToReplay, newRun, pick, skip, startOver, draftSelect, draftSet, copyExport, poolFilter, poolSelect, poolSet, poolCell, chooseSet, editBoss, discardBoss, resetBossForm, startRun, startCampaign, battleOne, rollMon, setLowPower, submitScore, setLanguage, toggleBoard, moreBoard, toggleMenu, toggleHelp, toggleNews, moreNews, openFeedback, feedbackTab, feedbackSpeciesChanged, pickFeedbackSpecies, closeFeedback, submitFeedback, openAuth, authMode, closeAuth, submitAuth, logout});
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
  // the last known account name is painted right away (the /me round trip confirms or clears it),
  // so a returning player does not see "Sign in" flip to their name
  try { const cached = localStorage.getItem('rollmons-account'); if (cached && AUTH_ENABLED) account = {name: cached}; } catch { /* private mode */ }
  renderAccount();
  void loadBoard();
  void loadAccount();
  $<HTMLInputElement>('low-power').checked = lowPower;
  $('title-foot-text').textContent = t('Loading game data…');
  try {
    // cache: 'no-cache' = always revalidate (ETag 304 when unchanged), so a landed contribution shows on the next reload
    const res = await fetch(new URL('./data/game-data.json', import.meta.url), {cache: 'no-cache'});
    if (!res.ok) throw new Error(`game data: HTTP ${res.status}`);
    const data = (await res.json()) as GameData;
    state.ctx = createGameContext(data);
    state.bossBook = new BossBook(state.ctx);
    state.matrix = matrixView(state.ctx);
    state.pool = poolSpecies(state.ctx);
    renderPool();
    feedRoller();
    renderBosses(state.bossBook.list());
    $('title-foot-text').textContent = t('Lv 100 · Gen 9'); // data-i18n keeps it translated after a language switch
    $('help-foot').classList.remove('hidden');
  } catch (e) {
    $('pool-summary').textContent = errorMessage(e);
    $('title-foot-text').textContent = t('Could not load game data: {error}', {error: errorMessage(e)});
  }
}

window.__rollmons = {view: () => state.view, screen: () => currentScreen, ready: battles.ready()};
boot();
