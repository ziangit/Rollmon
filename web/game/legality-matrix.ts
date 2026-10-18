// The 18×9 type-by-debut-generation draft legality matrix. Port of
// rollmons/legality_matrix.py; data comes in as objects (see data.ts).
import {DEFAULT_DRAFT_CONFIG} from './draft-config.ts';
import {loadUsableSmogonSets, type SmogonJson} from './smogon-sets.ts';
import {defaultRng, type WeightedRng} from './rng.ts';

export type Cell = readonly [type: string, generation: number];
export type SetSource = 'smogon' | 'randbats';

export const TYPES = [
  'bug', 'dark', 'dragon', 'electric', 'fairy', 'fighting', 'fire', 'flying', 'ghost', 'grass', 'ground',
  'ice', 'normal', 'poison', 'psychic', 'rock', 'steel', 'water',
] as const;
export const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const DEFAULT_LEGENDARY_WEIGHT = DEFAULT_DRAFT_CONFIG.legendaryWeight;
export const DEFAULT_ARCEUS_WEIGHT = DEFAULT_DRAFT_CONFIG.arceusWeight;
export const LEGENDARY_BST_THRESHOLD = 600;
export const LEGENDARY_BST_EXCLUSIONS = new Set([
  'slaking', // Truant suppresses the stat-ball; raw BST overstates competitive power.
  'regigigas', // Slow Start suppresses the stat-ball; raw BST overstates competitive power.
]);
export const MIN_CELL_SIZE = 1;
export const DEFAULT_SET_SOURCE: SetSource = 'smogon';

// Formes whose Showdown debut generation differs from the generation implied
// by their National Dex number (Dex.species.get(id).gen at commit a9caa4c).
export const FORME_DEBUT_GENERATION_OVERRIDES: Readonly<Record<string, number>> = {
  arcaninehisui: 8, arceusfairy: 6, articunogalar: 8, avalugghisui: 8, braviaryhisui: 8, decidueyehisui: 8,
  dialgaorigin: 8, dugtrioalola: 7, electrodehisui: 8, exeggutoralola: 7, golemalola: 7, goodrahisui: 8,
  greninjabond: 7, lilliganthisui: 8, moltresgalar: 8, mukalola: 7, ninetalesalola: 7, palkiaorigin: 8,
  persianalola: 7, qwilfishhisui: 8, raichualola: 7, samurotthisui: 8, sandslashalola: 7, slowbrogalar: 8,
  slowkinggalar: 8, taurospaldeaaqua: 9, taurospaldeablaze: 9, taurospaldeacombat: 9, typhlosionhisui: 8,
  ursalunabloodmoon: 9, weezinggalar: 8, zapdosgalar: 8, zoroarkhisui: 8,
};

export class LegalityDataError extends Error {}

export interface PokedexEntry {
  num?: number;
  name?: string;
  types?: string[];
  baseStats?: Record<string, number>;
  forme?: string;
  requiredItem?: string;
  [k: string]: unknown;
}
export type Pokedex = Record<string, PokedexEntry>;

export interface SpeciesMetadata {
  speciesId: string;
  name: string;
  types: string[];
  debutGeneration: number;
  baseStatTotal: number;
  legendary: boolean;
}

export const cellKey = (cell: Cell): string => `${cell[0]}:${cell[1]}`;
export const sameCell = (a: Cell | null | undefined, b: Cell | null | undefined) => !!a && !!b && a[0] === b[0] && a[1] === b[1];

/** Insertion-ordered map from cell to eligible species, mirroring the Python dict. */
export class CellMap {
  private readonly map = new Map<string, {cell: Cell; species: string[]}>();
  constructor(entries: Iterable<[Cell, string[]]> = []) { for (const [c, s] of entries) this.set(c, s); }
  get(cell: Cell): string[] | undefined { return this.map.get(cellKey(cell))?.species; }
  has(cell: Cell): boolean { return this.map.has(cellKey(cell)); }
  set(cell: Cell, species: string[]): this { this.map.set(cellKey(cell), {cell, species}); return this; }
  get size(): number { return this.map.size; }
  cells(): Cell[] { return [...this.map.values()].map((v) => v.cell); }
  entries(): [Cell, string[]][] { return [...this.map.values()].map((v) => [v.cell, v.species]); }
}

export interface LegalityData {
  atoms: string[];
  species: Record<string, SpeciesMetadata>;
  matrix: CellMap;
}

function generationFromNationalDexNumber(number: number): number {
  if (number <= 0) throw new LegalityDataError(`invalid National Dex number: ${number}`);
  const upperBounds = [151, 251, 386, 493, 649, 721, 809, 905];
  for (let i = 0; i < upperBounds.length; i++) if (number <= upperBounds[i]) return i + 1;
  return 9;
}

function debutGeneration(speciesId: string, entry: PokedexEntry): number {
  if (speciesId in FORME_DEBUT_GENERATION_OVERRIDES) return FORME_DEBUT_GENERATION_OVERRIDES[speciesId];
  if (!Number.isInteger(entry.num)) throw new LegalityDataError(`${speciesId} has no integer National Dex number`);
  return generationFromNationalDexNumber(entry.num as number);
}

function baseStatTotal(speciesId: string, entry: PokedexEntry): number {
  const stats = entry.baseStats;
  if (!stats || typeof stats !== 'object' || Object.keys(stats).length !== 6) throw new LegalityDataError(`${speciesId} has incomplete base stat data`);
  const values = Object.values(stats);
  if (!values.every((v) => Number.isInteger(v))) throw new LegalityDataError(`${speciesId} has non-integer base stat data`);
  return values.reduce((a, b) => a + b, 0);
}

function validateNoBattleOnlyMechanics(speciesId: string, entry: PokedexEntry): void {
  const forme = String(entry.forme ?? '').toLowerCase();
  if (forme.startsWith('mega') || forme.startsWith('gmax')) {
    throw new LegalityDataError(`battle-only Mega or Gigantamax forme leaked into randbats: ${speciesId}`);
  }
}

/** Build all 18x9 cells, including cells excluded from slot-machine rolls. */
export function buildAllCells(species: Record<string, SpeciesMetadata>): CellMap {
  const candidates = new CellMap();
  for (const type of TYPES) for (const generation of GENERATIONS) candidates.set([type, generation], []);
  for (const [speciesId, metadata] of Object.entries(species)) {
    for (const type of metadata.types) {
      const cell: Cell = [type, metadata.debutGeneration];
      const bucket = candidates.get(cell);
      if (!bucket) throw new LegalityDataError(`${speciesId} has unsupported type/generation cell ${cellKey(cell)}`);
      bucket.push(speciesId);
    }
  }
  return new CellMap(candidates.entries().map(([cell, eligible]) => [cell, [...eligible].sort()]));
}

/** Build draftable cells, excluding every cell below `minCellSize`. */
export function buildMatrix(species: Record<string, SpeciesMetadata>, minCellSize = MIN_CELL_SIZE): CellMap {
  if (minCellSize < 1) throw new RangeError('minCellSize must be positive');
  return new CellMap(buildAllCells(species).entries().filter(([, eligible]) => eligible.length >= minCellSize));
}

/** Every unfiltered type-generation cell occupied by one atom. */
export function cellsForSpecies(metadata: SpeciesMetadata): Cell[] {
  return metadata.types.map((type) => [type, metadata.debutGeneration] as const);
}

export interface WeightOptions { legendaryWeight?: number; arceusWeight?: number }

/** The configured relative draft weight for one atom. */
export function selectionWeight(metadata: SpeciesMetadata, opts: WeightOptions = {}): number {
  if (metadata.speciesId.startsWith('arceus')) return opts.arceusWeight ?? DEFAULT_ARCEUS_WEIGHT;
  if (metadata.legendary) return opts.legendaryWeight ?? DEFAULT_LEGENDARY_WEIGHT;
  return 1;
}

export interface LegalityInputs {
  pokedex: Pokedex;
  randbats: Record<string, unknown>;
  /** Smogon JSON (ingested here) or already-ingested usable sets. */
  /** Raw Smogon dump (rollmons/data/smogon_sets.json); ingested here. */
  smogon?: SmogonJson;
  moves?: Record<string, unknown>;
  /** set-override files, keyed by file stem (= species id) */
  overrides?: Record<string, string>;
  source?: SetSource;
}

function atomsForSource(inputs: LegalityInputs, source: SetSource): string[] {
  if (source === 'randbats') return Object.keys(inputs.randbats).sort();
  if (source === 'smogon') {
    if (!inputs.smogon) throw new LegalityDataError('smogon source selected but no Smogon data given');
    return Object.keys(loadUsableSmogonSets(inputs.smogon, {pokedex: inputs.pokedex, moves: inputs.moves ?? {}})).sort();
  }
  throw new LegalityDataError(`unsupported set source '${source}'; expected 'smogon' or 'randbats'`);
}

/** Load source data and return atoms, metadata, and the filtered matrix. */
export function buildLegalityData(inputs: LegalityInputs): LegalityData {
  const source = inputs.source ?? DEFAULT_SET_SOURCE;
  const pokedex = inputs.pokedex;
  const sourceAtoms = atomsForSource(inputs, source);
  // Checked-in set overrides contribute draftable atoms so a species with a
  // custom set (e.g. a Mega-Stone set) is draftable even when the configured
  // source has no usable set for it. Non-species files are filtered out here.
  const overrideAtoms = Object.keys(inputs.overrides ?? {}).sort().filter((id) => id in pokedex);
  const atoms = [...new Set([...sourceAtoms, ...overrideAtoms])].sort();
  const species: Record<string, SpeciesMetadata> = {};

  for (const speciesId of atoms) {
    const entry = pokedex[speciesId];
    if (!entry || typeof entry !== 'object') throw new LegalityDataError(`${source} atom ${speciesId} is missing from the Pokedex`);
    validateNoBattleOnlyMechanics(speciesId, entry);
    if (!Array.isArray(entry.types) || !entry.types.length) throw new LegalityDataError(`${speciesId} has no current type data`);
    const bst = baseStatTotal(speciesId, entry);
    species[speciesId] = {
      speciesId,
      name: String(entry.name ?? speciesId),
      types: entry.types.map((t) => String(t).toLowerCase()),
      debutGeneration: debutGeneration(speciesId, entry),
      baseStatTotal: bst,
      // "Legendary" is deliberately a competitive-power category, not Pokedex
      // lore: exactly-600 mythicals and pseudo-legendaries are normal atoms.
      legendary: bst > LEGENDARY_BST_THRESHOLD && !LEGENDARY_BST_EXCLUSIONS.has(speciesId),
    };
  }
  return {atoms, species, matrix: buildMatrix(species)};
}

/** The selector's normalized probability for every eligible atom. */
export function selectionProbabilities(cell: Cell, matrix: CellMap, species: Record<string, SpeciesMetadata>, opts: WeightOptions = {}): Map<string, number> {
  const legendaryWeight = opts.legendaryWeight ?? DEFAULT_LEGENDARY_WEIGHT;
  const arceusWeight = opts.arceusWeight ?? DEFAULT_ARCEUS_WEIGHT;
  if (!(legendaryWeight > 0)) throw new RangeError('legendaryWeight must be greater than zero');
  if (!(arceusWeight > 0)) throw new RangeError('arceusWeight must be greater than zero');
  const eligible = matrix.get(cell) ?? [];
  if (!eligible.length) throw new Error(`cell is not eligible: ${cellKey(cell)}`);
  const weights = eligible.map((id) => {
    const metadata = species[id];
    if (!metadata) throw new LegalityDataError(`cell ${cellKey(cell)} references unknown species ${id}`);
    return selectionWeight(metadata, {legendaryWeight, arceusWeight});
  });
  const total = weights.reduce((a, b) => a + b, 0);
  return new Map(eligible.map((id, i) => [id, weights[i] / total]));
}

/** Select one eligible atom, down-weighting but never banning legendaries. */
export function selectSpecies(cell: Cell, matrix: CellMap, species: Record<string, SpeciesMetadata>, opts: WeightOptions & {rng?: WeightedRng} = {}): string {
  const probabilities = selectionProbabilities(cell, matrix, species, opts);
  return (opts.rng ?? defaultRng).weightedChoice([...probabilities.keys()], [...probabilities.values()]);
}
