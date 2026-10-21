// In-page replacement for the v1 FastAPI session (rollmons/web_app.py): one
// run's draft, loadout, gauntlet/campaign progress, custom bosses, and damage
// totals, plus the view objects the page renders. Pure: battles are run by the
// caller (the worker client) and recorded here.
import type {Choice} from '../battle/runner.ts';
import {accumulatePlayerDamage, damagePayload, gauntletDamageSummary, seedDamageTracking, type DamagePayload} from '../battle/summary.ts';
import {bossDisplayName, listBossIds, loadBossTeam, type Bosses} from '../game/bosses.ts';
import type {GameData} from '../game/data.ts';
import {Draft, DraftError, type DraftOffer} from '../game/draft.ts';
import {DEFAULT_DRAFT_CONFIG, draftConfig, type DraftConfig} from '../game/draft-config.ts';
import {
  DEFAULT_SET_SOURCE, GENERATIONS, RARITY_NAMES, TYPES, buildAllCells, buildLegalityData,
  type Cell, type CellMap, type LegalityData, type Rarity, type SetSource, type SpeciesMetadata,
} from '../game/legality-matrix.ts';
import {buildCampaign, PoolError} from '../game/pool.ts';
import {seededRng, type Rng} from '../game/rng.ts';
import {scoreRun, type RunScore} from '../game/score.ts';
import {loadUsableSmogonSets, type SmogonSet} from '../game/smogon-sets.ts';
import {BattleEntityNotFoundError, SubmissionError, parseShowdownExport, verifyTeamEntitiesExist} from '../game/submissions.ts';
import {
  DEFAULT_IVS, FIXED_LEVEL, NEUTRAL_EVS, NEUTRAL_NATURE, STATS, loadRandomBattleSets, loadSetOverride, normalizeOverrideExport,
  representativeRandomBattleSet, representativeSmogonSet, selectableSets, type RandomBattleSet, type SelectableSet,
} from '../game/team-assembly.ts';
import {spriteUrl} from './sprites.ts';

export const PLAYER_NAME = 'Player';
export const BOSS_ORDER_MIN = 1;
export const BOSS_ORDER_MAX = 10;

export class SessionError extends Error {}

/** Per-slot rarity odds as percentages (common, uncommon, rare, legendary). */
export function rarityOddsPercent(odds: readonly number[]): number[] {
  const total = odds.reduce((a, b) => a + b, 0);
  return odds.map((o) => Math.round((o / total) * 1000) / 10);
}

// ---------------------------------------------------------------- context

/** Everything derived once from the data bundle and shared by all sessions. */
export interface GameContext {
  data: GameData;
  setSource: SetSource;
  config: DraftConfig;
  legality: LegalityData;
  allCells: CellMap;
  randbats: Record<string, RandomBattleSet[]>;
  smogon: Record<string, SmogonSet[]>;
}

export function createGameContext(data: GameData, opts: {setSource?: SetSource; config?: Partial<DraftConfig>} = {}): GameContext {
  const setSource = opts.setSource ?? DEFAULT_SET_SOURCE;
  const legality = buildLegalityData({...data, source: setSource});
  return {
    data, setSource, config: draftConfig(opts.config), legality, allCells: buildAllCells(legality.species),
    randbats: loadRandomBattleSets(data.randbats),
    smogon: setSource === 'smogon' ? loadUsableSmogonSets(data.smogon, data) : {},
  };
}

// ---------------------------------------------------------------- views

export interface SetView {
  source: 'override' | 'smogon' | 'randbats';
  label: string;
  format: string | null;
  /** full PokéPaste when the source ships one; randbats sets are built by the page */
  export: string | null;
  item: string;
  ability: string;
  moves: string[];
  observedCount: number;
  roleCount: number;
}

export interface SpeciesView {
  id: string;
  name: string;
  types: string[];
  debutGeneration: number;
  baseStatTotal: number;
  tier: string | null;
  rarity: Rarity;
  rarityName: string;
  legendary: boolean;
  spriteUrl: string;
  set: SetView;
  assemblySpread: {level: number; nature: string; evs: Record<string, number>; ivs: Record<string, number>};
}

/** `visitor`: offered from a neighbouring generation because the cell is short of natives. */
export interface CandidateView extends SpeciesView { visitor: boolean }

export interface OfferView {
  roundNumber: number;
  cell: {type: string; generation: number};
  candidates: CandidateView[];
  suggestedSpecies: string;
  skipsRemaining: number;
  thinRerollAvailable: boolean;
  candidateCap: number;
  thinCellThreshold: number;
  /** per-slot rarity odds, as percentages of their total */
  rarityOdds: number[];
}

export interface LoadoutEntry {
  speciesId: string;
  name: string;
  spriteUrl: string;
  chosenSetId: string;
  locked: boolean;
  sets: SelectableSet[];
}

export interface BossInfo { id: string; name: string; source: 'file' | 'edited' | 'custom' }

export interface BattleResult {
  battleId: string;
  playerName: string;
  bossName: string;
  winner: 'player' | 'boss' | 'tie';
  turns: number;
  /** omniscient protocol log (feeds the replay embed and the damage summary) */
  log: string[];
  megas: number;
  problems: string[];
  /** every choice the sim accepted, in order (the run proof; docs/ROADMAP.md §7) */
  choices: Choice[];
}

/** Everything needed to re-run a campaign without the search engine: verifyRun() in verify.ts. */
export interface RunProof {
  version: 1;
  seed: number;
  /** draft and loadout actions in order: pick:<id>, skip, reroll, set:<id>:<setId>, campaign:<0|1> */
  actions: string[];
  battles: {choices: Choice[]}[];
}

/** What the worker needs for the next battle. */
export interface BattleSpec { battleId: string; bossId: string; bossName: string; playerTeam: string; bossTeam: string; seed: number }

export interface GauntletView {
  bosses: {id: string; name: string; complete: boolean; current: boolean}[];
  nextIndex: number;
  complete: boolean;
  summary: string | null;
  stopOnLoss: boolean;
  damage: DamagePayload;
  results: BattleResult[];
  /** true for the tiered campaign (the scored mode), false for a manual ladder */
  campaign: boolean;
  /** leaderboard score once a campaign is complete */
  score: RunScore | null;
}

export interface SessionView {
  complete: boolean;
  roundNumber: number;
  team: SpeciesView[];
  offer: OfferView | null;
  skipsRemaining: number;
  draftConfig: DraftConfig;
  teamExport: string | null;
  loadout: LoadoutEntry[] | null;
  battleResult: BattleResult | null;
  gauntlet: GauntletView;
}

export interface MatrixCellView {
  type: string;
  generation: number;
  included: boolean;
  state: 'excluded' | 'thin' | 'normal';
  eligibleCount: number;
  pokemon: SpeciesView[];
}

export interface MatrixView {
  types: string[];
  generations: number[];
  includedCellCount: number;
  atomCount: number;
  setSource: SetSource;
  cells: MatrixCellView[];
}

const speciesViewCache = new WeakMap<GameContext, Map<string, SpeciesView>>();

/** Species card data: metadata, sprite, and the representative set (override > source). */
export function speciesView(ctx: GameContext, speciesId: string): SpeciesView {
  let cache = speciesViewCache.get(ctx);
  if (!cache) speciesViewCache.set(ctx, (cache = new Map()));
  const hit = cache.get(speciesId);
  if (hit) return hit;
  const metadata = ctx.legality.species[speciesId];
  if (!metadata) throw new SessionError(`'${speciesId}' is not a draftable species`);
  const override = loadSetOverride(speciesId, ctx.data.overrides);
  let set: SetView;
  if (override !== null) {
    const member = parseShowdownExport(override, {expectedMembers: 1, source: speciesId})[0];
    set = {
      source: 'override', label: 'Custom set', format: null, export: normalizeOverrideExport(override),
      item: member.item, ability: member.ability, moves: [...member.moves], observedCount: 1, roleCount: 1,
    };
  } else if (ctx.setSource === 'smogon' && speciesId in ctx.smogon) {
    const r = representativeSmogonSet(speciesId, ctx.smogon);
    set = {
      source: 'smogon', label: r.label, format: r.format, export: r.export, item: r.item, ability: r.ability,
      moves: [...r.moves], observedCount: 1, roleCount: ctx.smogon[speciesId].length,
    };
  } else {
    const r = representativeRandomBattleSet(speciesId, ctx.randbats);
    set = {
      source: 'randbats', label: 'Random set', format: null, export: null, item: r.item, ability: r.ability,
      moves: [...r.moves], observedCount: r.observedCount, roleCount: ctx.randbats[speciesId].length,
    };
  }
  const view: SpeciesView = {
    id: speciesId, name: metadata.name, types: [...metadata.types], debutGeneration: metadata.debutGeneration,
    baseStatTotal: metadata.baseStatTotal, tier: metadata.tier ?? null, rarity: metadata.rarity, rarityName: RARITY_NAMES[metadata.rarity],
    legendary: metadata.legendary,
    spriteUrl: spriteUrl(metadata, ctx.data.pokedex[speciesId]), set,
    assemblySpread: {
      level: FIXED_LEVEL, nature: NEUTRAL_NATURE,
      evs: Object.fromEntries(STATS.map((s) => [s, NEUTRAL_EVS])), ivs: Object.fromEntries(STATS.map((s) => [s, DEFAULT_IVS])),
    },
  };
  cache.set(speciesId, view);
  return view;
}

export function matrixView(ctx: GameContext): MatrixView {
  const cells: MatrixCellView[] = [];
  for (const type of TYPES) {
    for (const generation of GENERATIONS) {
      const cell: Cell = [type, generation];
      const eligible = ctx.allCells.get(cell) ?? [];
      cells.push({
        type, generation, included: ctx.legality.matrix.has(cell),
        state: !eligible.length ? 'excluded' : eligible.length < ctx.config.thinCellThreshold ? 'thin' : 'normal',
        eligibleCount: eligible.length, pokemon: eligible.map((id) => speciesView(ctx, id)),
      });
    }
  }
  return {
    types: [...TYPES], generations: [...GENERATIONS], includedCellCount: ctx.legality.matrix.size,
    atomCount: ctx.legality.atoms.length, setSource: ctx.setSource, cells,
  };
}

export function speciesSetOptions(ctx: GameContext, speciesId: string): SelectableSet[] {
  return selectableSets(speciesId, {
    smogonSets: ctx.smogon, randbatsSets: ctx.randbats, pokedex: ctx.data.pokedex, setSource: ctx.setSource, overrides: ctx.data.overrides,
  });
}

// ---------------------------------------------------------------- bosses

/** The authored boss files plus bosses pasted or edited in this page session. */
export class BossBook {
  private readonly custom = new Map<string, {name: string; export: string}>();
  private nextCustom = 1;
  private readonly ctx: GameContext;

  constructor(ctx: GameContext) { this.ctx = ctx; }

  list(): BossInfo[] {
    const files: BossInfo[] = listBossIds(this.ctx.data.bosses).map((id) => ({id, name: this.name(id), source: this.custom.has(id) ? 'edited' : 'file'}));
    const pasted: BossInfo[] = [...this.custom].filter(([id]) => id.startsWith('custom-')).map(([id, b]) => ({id, name: b.name, source: 'custom'}));
    return [...files, ...pasted];
  }

  name(bossId: string): string {
    return this.custom.get(bossId)?.name ?? bossDisplayName(bossId, this.ctx.data.bosses);
  }

  /** Throws BossTeamError for an unknown id. */
  team(bossId: string): string {
    return this.custom.get(bossId)?.export ?? loadBossTeam(bossId, this.ctx.data.bosses);
  }

  info(bossId: string): BossInfo & {export: string} {
    const source = bossId.startsWith('custom-') ? 'custom' : this.custom.has(bossId) ? 'edited' : 'file';
    return {id: bossId, name: this.name(bossId), source, export: this.team(bossId)};
  }

  /** Validate a pasted six-member export; throws SessionError with the reason. */
  validateExport(name: string, exportText: string): string {
    const cleaned = exportText.trim();
    try {
      parseShowdownExport(cleaned, {expectedMembers: 6, source: name});
      verifyTeamEntitiesExist({boss: cleaned}, this.ctx.data);
    } catch (err) {
      if (err instanceof SubmissionError || err instanceof BattleEntityNotFoundError) throw new SessionError(err.message);
      throw err;
    }
    return cleaned;
  }

  addCustom(name: string, exportText: string): BossInfo {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new SessionError('boss name must be 1–80 characters');
    const cleaned = this.validateExport(trimmed, exportText);
    const id = `custom-${this.nextCustom++}`;
    this.custom.set(id, {name: trimmed, export: cleaned});
    return {id, name: trimmed, source: 'custom'};
  }

  edit(bossId: string, name: string, exportText: string): BossInfo {
    this.team(bossId); // throws for an unknown id
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new SessionError('boss name must be 1–80 characters');
    const cleaned = this.validateExport(trimmed, exportText);
    this.custom.set(bossId, {name: trimmed, export: cleaned});
    return {id: bossId, name: trimmed, source: bossId.startsWith('custom-') ? 'custom' : 'edited'};
  }
}

// ---------------------------------------------------------------- session

export interface SessionOptions { seed?: number; bosses?: BossBook; config?: Partial<DraftConfig> }

export class GameSession {
  readonly seed: number;
  readonly draft: Draft;
  readonly bosses: BossBook;
  private readonly rng: Rng;
  private loadout: Record<string, string> | null = null;
  private teamExport: string | null = null;
  private battleResult: BattleResult | null = null;
  private gauntletBossIds: string[] = [];
  private gauntletNextIndex = 0;
  private gauntletResults: BattleResult[] = [];
  private gauntletStopOnLoss = false;
  private damage: {totals: Map<string, number>; display: Map<string, string>} | null = null;
  /** campaign mode: pool-team stem -> export (the stem is also the display name) */
  private campaignTeams: Map<string, string> | null = null;
  private battleCounter = 0;
  /** draft/loadout/campaign actions, replayable from the seed (RunProof) */
  private readonly actions: string[] = [];
  /** false once a manual ladder or exhibition battle has consumed battle seeds */
  private proofEligible = true;
  private readonly ctx: GameContext;

  constructor(ctx: GameContext, opts: SessionOptions = {}) {
    this.ctx = ctx;
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = seededRng(this.seed + 1);
    this.draft = new Draft(ctx.legality, {rng: seededRng(this.seed), config: {...ctx.config, ...opts.config}});
    this.bosses = opts.bosses ?? new BossBook(ctx);
  }

  // ---- draft

  pick(speciesId: string): void {
    this.draft.submitPick(speciesId);
    this.actions.push(`pick:${speciesId}`);
    if (this.draft.complete) {
      this.loadout = this.defaultLoadout();
      this.teamExport = this.assembleFromLoadout();
    }
  }

  skip(): void { this.draft.useSkip(); this.actions.push('skip'); }
  thinReroll(): void { this.draft.useThinReroll(); this.actions.push('reroll'); }

  // ---- loadout

  get battlesStarted(): boolean { return this.gauntletBossIds.length > 0 || this.battleResult !== null; }

  chooseSet(speciesId: string, setId: string): void {
    if (!this.draft.complete || !this.loadout) throw new SessionError('draft is not complete');
    if (this.battlesStarted) throw new SessionError('loadout is locked once battles have started');
    if (!(speciesId in this.loadout)) throw new SessionError('species is not on the drafted team');
    if (!speciesSetOptions(this.ctx, speciesId).some((o) => o.setId === setId)) throw new SessionError('unknown set for this species');
    this.loadout[speciesId] = setId;
    this.teamExport = this.assembleFromLoadout();
    this.actions.push(`set:${speciesId}:${setId}`);
  }

  private defaultLoadout(): Record<string, string> {
    const loadout: Record<string, string> = {};
    for (const speciesId of this.draft.picks) {
      const options = speciesSetOptions(this.ctx, speciesId);
      if (!options.length) throw new SessionError(`no selectable sets for ${speciesId}`);
      // Default to a non-Mega set so Mega is an opt-in choice and a fresh
      // team is not all-Mega (only one Mega can evolve per battle anyway).
      loadout[speciesId] = (options.find((o) => !o.isMega) ?? options[0]).setId;
    }
    return loadout;
  }

  private assembleFromLoadout(): string {
    return Object.entries(this.loadout!).map(([speciesId, setId]) => {
      const options = speciesSetOptions(this.ctx, speciesId);
      return (options.find((o) => o.setId === setId) ?? options[0]).export;
    }).join('\n\n');
  }

  // ---- gauntlet / campaign

  private requireTeam(): string {
    if (!this.draft.complete || this.teamExport === null) throw new SessionError('draft is not complete');
    return this.teamExport;
  }

  private resetGauntlet(bossIds: string[], stopOnLoss: boolean): void {
    this.gauntletBossIds = bossIds;
    this.gauntletNextIndex = 0;
    this.gauntletResults = [];
    this.gauntletStopOnLoss = stopOnLoss;
    this.damage = seedDamageTracking(this.draft.picks.map((id) => this.ctx.legality.species[id].name));
  }

  /** Manual ladder over authored/custom bosses (1–10, in the given order). */
  startGauntlet(bossIds: string[] | null, stopOnLoss: boolean): void {
    this.requireTeam();
    const ids = bossIds ?? listBossIds(this.ctx.data.bosses);
    if (ids.length < BOSS_ORDER_MIN) throw new SessionError('no boss teams found');
    if (ids.length > BOSS_ORDER_MAX) throw new SessionError(`boss rush supports at most ${BOSS_ORDER_MAX} bosses`);
    for (const id of ids) this.bosses.team(id);
    this.campaignTeams = null;
    this.proofEligible = false;
    this.resetGauntlet([...ids], stopOnLoss);
  }

  /** The tiered ten-battle campaign drawn from rollmons/pool. */
  startCampaign(stopOnLoss: boolean): void {
    this.requireTeam();
    let campaign;
    try { campaign = buildCampaign(this.ctx.data.pool, {rng: this.rng}); } catch (err) {
      if (err instanceof PoolError) throw new SessionError(err.message);
      throw err;
    }
    this.campaignTeams = new Map(campaign.map((b) => [b.teamId, b.export]));
    if (this.battleCounter > 0) this.proofEligible = false; // earlier battles consumed seeds the proof cannot replay
    this.actions.push(`campaign:${stopOnLoss ? 1 : 0}`);
    this.resetGauntlet(campaign.map((b) => b.teamId), stopOnLoss);
  }

  private resolveBossName(bossId: string): string {
    return this.campaignTeams?.has(bossId) ? bossId : this.bosses.name(bossId);
  }

  private resolveBossTeam(bossId: string): string {
    return this.campaignTeams?.get(bossId) ?? this.bosses.team(bossId);
  }

  private spec(bossId: string): BattleSpec {
    const playerTeam = this.requireTeam();
    const bossTeam = this.resolveBossTeam(bossId);
    verifyTeamEntitiesExist({player: playerTeam, boss: bossTeam}, this.ctx.data);
    const n = ++this.battleCounter;
    return {battleId: `b${this.seed}-${n}`, bossId, bossName: this.resolveBossName(bossId), playerTeam, bossTeam, seed: this.seed * 1000 + n};
  }

  get gauntletComplete(): boolean {
    return this.gauntletBossIds.length > 0 && this.gauntletNextIndex >= this.gauntletBossIds.length;
  }

  /** The next gauntlet battle to run, or null when the gauntlet is over or not started. */
  nextBattleSpec(): BattleSpec | null {
    if (!this.gauntletBossIds.length) throw new SessionError('gauntlet has not started');
    if (this.gauntletComplete) return null;
    return this.spec(this.gauntletBossIds[this.gauntletNextIndex]);
  }

  /** Record a finished gauntlet battle, fold its damage in, and advance (or stop on a loss). */
  recordGauntletBattle(spec: BattleSpec, outcome: {winner: string; turns: number; log: string[]; megas?: number; problems?: string[]; choices?: Choice[]}): BattleResult {
    if (this.gauntletBossIds[this.gauntletNextIndex] !== spec.bossId) throw new SessionError('battle does not match the next gauntlet boss');
    const result = this.toResult(spec, outcome);
    this.gauntletResults.push(result);
    if (!this.damage) this.damage = seedDamageTracking(this.draft.picks.map((id) => this.ctx.legality.species[id].name));
    accumulatePlayerDamage(this.damage.totals, this.damage.display, result.log, PLAYER_NAME);
    this.battleResult = result;
    this.gauntletNextIndex += 1;
    if (this.gauntletStopOnLoss && result.winner !== 'player') this.gauntletNextIndex = this.gauntletBossIds.length;
    return result;
  }

  /** A single exhibition battle outside the gauntlet. */
  singleBattleSpec(bossId: string): BattleSpec { this.proofEligible = false; return this.spec(bossId); }

  recordSingleBattle(spec: BattleSpec, outcome: {winner: string; turns: number; log: string[]; megas?: number; problems?: string[]; choices?: Choice[]}): BattleResult {
    this.battleResult = this.toResult(spec, outcome);
    return this.battleResult;
  }

  private toResult(spec: BattleSpec, o: {winner: string; turns: number; log: string[]; megas?: number; problems?: string[]; choices?: Choice[]}): BattleResult {
    const winner = o.winner === PLAYER_NAME ? 'player' : o.winner === spec.bossName ? 'boss' : 'tie';
    return {
      battleId: spec.battleId, playerName: PLAYER_NAME, bossName: spec.bossName, winner, turns: o.turns,
      log: o.log, megas: o.megas ?? 0, problems: o.problems ?? [], choices: o.choices ?? [],
    };
  }

  // ---- score and proof

  get isCampaign(): boolean { return this.campaignTeams !== null; }

  /** Leaderboard score of a complete campaign (docs/ROADMAP.md §7), else null. */
  score(): RunScore | null {
    if (!this.isCampaign || !this.gauntletComplete || !this.gauntletResults.length) return null;
    const team = this.draft.picks.map((id) => ({speciesId: id, tier: this.ctx.data.tiers[id], baseStatTotal: this.ctx.legality.species[id].baseStatTotal}));
    return scoreRun(this.gauntletResults, team);
  }

  /** The replayable record of a complete campaign, or null if this run cannot be verified. */
  runProof(): RunProof | null {
    if (!this.proofEligible || !this.isCampaign || !this.gauntletComplete) return null;
    if (this.gauntletResults.some((r) => !r.choices.length)) return null;
    return {version: 1, seed: this.seed, actions: [...this.actions], battles: this.gauntletResults.map((r) => ({choices: r.choices}))};
  }

  // ---- views

  private offerView(offer: DraftOffer | null): OfferView | null {
    if (!offer) return null;
    return {
      roundNumber: offer.roundNumber, cell: {type: offer.cell[0], generation: offer.cell[1]},
      candidates: offer.candidates.map((id) => ({...speciesView(this.ctx, id), visitor: offer.visitors.includes(id)})),
      suggestedSpecies: offer.suggestedSpecies, skipsRemaining: offer.skipsRemaining, thinRerollAvailable: offer.thinRerollAvailable,
      candidateCap: this.ctx.config.candidateCap, thinCellThreshold: this.ctx.config.thinCellThreshold,
      rarityOdds: rarityOddsPercent(this.ctx.config.rarityOdds),
    };
  }

  private loadoutView(): LoadoutEntry[] | null {
    if (!this.draft.complete || !this.loadout) return null;
    return this.draft.picks.map((speciesId) => {
      const metadata = this.ctx.legality.species[speciesId];
      return {
        speciesId, name: metadata.name, spriteUrl: spriteUrl(metadata, this.ctx.data.pokedex[speciesId]),
        chosenSetId: this.loadout![speciesId], locked: this.battlesStarted, sets: speciesSetOptions(this.ctx, speciesId),
      };
    });
  }

  gauntletView(): GauntletView {
    const ids = this.gauntletBossIds;
    const results = this.gauntletResults;
    const complete = this.gauntletComplete;
    let summary: string | null = null;
    if (complete && results.length) {
      const wins = results.filter((r) => r.winner === 'player').length;
      const losses = results.filter((r) => r.winner === 'boss').length;
      const ties = results.filter((r) => r.winner === 'tie').length;
      const avg = results.reduce((s, r) => s + r.turns, 0) / results.length;
      summary = `Your record is ${ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`}! Average turn is ${avg.toFixed(1)}.`;
      const dmg = this.damage ? gauntletDamageSummary(this.damage.totals, this.damage.display) : null;
      if (dmg) summary = `${summary} ${dmg}`;
    }
    return {
      bosses: ids.map((id, i) => ({id, name: this.resolveBossName(id), complete: i < this.gauntletNextIndex, current: i === this.gauntletNextIndex && !complete})),
      nextIndex: this.gauntletNextIndex, complete, summary, stopOnLoss: this.gauntletStopOnLoss,
      damage: this.damage ? damagePayload(this.damage.totals, this.damage.display) : damagePayload(new Map()),
      results: [...results],
      campaign: this.isCampaign,
      score: this.score(),
    };
  }

  view(): SessionView {
    const draft = this.draft;
    return {
      complete: draft.complete,
      roundNumber: draft.complete ? draft.picks.length : draft.currentOffer!.roundNumber,
      team: draft.picks.map((id) => speciesView(this.ctx, id)),
      offer: this.offerView(draft.currentOffer),
      skipsRemaining: draft.skipsRemaining,
      draftConfig: {...this.ctx.config},
      teamExport: this.teamExport,
      loadout: this.loadoutView(),
      battleResult: this.battleResult,
      gauntlet: this.gauntletView(),
    };
  }
}

export {DraftError, DEFAULT_DRAFT_CONFIG};
export type {SpeciesMetadata};
