// Assemble drafted atoms into fixed-level Showdown exports and enumerate the
// sets a player may choose on the loadout screen. Port of rollmons/team_assembly.py.
import {TEAM_SIZE} from './draft.ts';
import {DEFAULT_SET_SOURCE, type Pokedex, type SetSource} from './legality-matrix.ts';
import {defaultRng, type WeightedRng} from './rng.ts';
import {exportBlocks, titleCase, toId} from './showdown-export.ts';
import {loadUsableSmogonSets, type SmogonJson, type SmogonSet} from './smogon-sets.ts';
import {parseShowdownExport, SubmissionError} from './submissions.ts';

export const FIXED_LEVEL = 100;
export const NEUTRAL_NATURE = 'Serious';
export const NEUTRAL_EVS = 85;
export const DEFAULT_IVS = 31;
export const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'] as const;

export class TeamAssemblyError extends Error {}

export interface RandomBattleSet {
  sourceLevel: number;
  item: string;
  ability: string;
  moves: string[];
  teraType: string;
  observedCount: number;
}

export type RandbatsJson = Record<string, Record<string, number>>;
/** Set-override files keyed by file stem (= species id). */
export type Overrides = Record<string, string>;

export function parseRandomBattleSet(encoded: string, observedCount: number): RandomBattleSet {
  const fields = encoded.split(',');
  if (fields.length < 5) throw new TeamAssemblyError(`expected level, item, ability, moves, and tera type: ${encoded}`);
  const [level, item, ability] = fields;
  const moves = fields.slice(3, -1);
  const teraType = fields[fields.length - 1];
  if (moves.length < 1 || moves.length > 4) throw new TeamAssemblyError(`expected one to four moves: ${encoded}`);
  if (observedCount <= 0) throw new TeamAssemblyError('randbats observed count must be positive');
  return {sourceLevel: Number(level), item, ability, moves, teraType, observedCount};
}

export function loadRandomBattleSets(json: RandbatsJson): Record<string, RandomBattleSet[]> {
  return Object.fromEntries(Object.entries(json).map(([id, sets]) => [id, Object.entries(sets).map(([e, n]) => parseRandomBattleSet(e, n))]));
}

export function selectRandomBattleSet(speciesId: string, sets: Record<string, RandomBattleSet[]>, rng: WeightedRng = defaultRng): RandomBattleSet {
  const available = sets[speciesId] ?? [];
  if (!available.length) throw new TeamAssemblyError(`no randbats sets for ${speciesId}`);
  return rng.weightedChoice(available, available.map((s) => s.observedCount));
}

/** The most frequently observed randbats set, for inspection. */
export function representativeRandomBattleSet(speciesId: string, sets: Record<string, RandomBattleSet[]>): RandomBattleSet {
  const available = sets[speciesId] ?? [];
  if (!available.length) throw new TeamAssemblyError(`no randbats sets for ${speciesId}`);
  return available.reduce((best, s) => (s.observedCount > best.observedCount ? s : best));
}

export function selectSmogonSet(speciesId: string, sets: Record<string, SmogonSet[]>, rng: WeightedRng = defaultRng): SmogonSet {
  const available = sets[speciesId] ?? [];
  if (!available.length) throw new TeamAssemblyError(`no Smogon sets for ${speciesId}`);
  return rng.weightedChoice(available, available.map(() => 1));
}

export function representativeSmogonSet(speciesId: string, sets: Record<string, SmogonSet[]>): SmogonSet {
  const available = sets[speciesId] ?? [];
  if (!available.length) throw new TeamAssemblyError(`no Smogon sets for ${speciesId}`);
  return available[0];
}

const displayName = (value: string) => titleCase(value.replaceAll('-', ' ')).replaceAll(' ', '-');

function exportMember(name: string, set: RandomBattleSet): string {
  // This legal 510-EV neutral spread is deliberate: it matches the randbats
  // parser the AI was validated piloting; it is not an optimized spread.
  const evs = STATS.map((stat) => `${NEUTRAL_EVS} ${stat}`).join(' / ');
  return [
    `${name} @ ${displayName(set.item)}`,
    `Ability: ${displayName(set.ability)}`,
    `Level: ${FIXED_LEVEL}`,
    `EVs: ${evs}`,
    `${NEUTRAL_NATURE} Nature`,
    ...set.moves.map((move) => `- ${displayName(move)}`),
  ].join('\n');
}

/** Every checked-in override set for a species (one export block each). */
export function loadSetOverrides(speciesId: string, overrides: Overrides): string[] {
  const text = overrides[speciesId];
  if (text === undefined) return [];
  try {
    const blocks = exportBlocks(text).map((b) => b.trim());
    for (const block of blocks) {
      const member = parseShowdownExport(block, {expectedMembers: 1, source: `${speciesId}.txt`})[0];
      if (member.species !== speciesId) throw new TeamAssemblyError(`set override ${speciesId}.txt contains ${member.species}, expected ${speciesId}`);
    }
    return blocks;
  } catch (err) {
    if (err instanceof SubmissionError || err instanceof TeamAssemblyError) throw new TeamAssemblyError(`invalid set override for ${speciesId}: ${err.message}`, {cause: err});
    throw err;
  }
}

/** The first override set for a species, if any. */
export function loadSetOverride(speciesId: string, overrides: Overrides): string | null {
  const all = loadSetOverrides(speciesId, overrides);
  return all.length ? all[0] : null;
}

export interface AssemblyData {
  pokedex: Pokedex;
  randbats: RandbatsJson;
  /** Raw Smogon dump (rollmons/data/smogon_sets.json); ingested here. */
  smogon?: SmogonJson;
  moves?: Record<string, unknown>;
  overrides?: Overrides;
  source?: SetSource;
}

function usableSmogon(data: AssemblyData, source: SetSource): Record<string, SmogonSet[]> {
  if (source !== 'smogon' || !data.smogon) return {};
  return loadUsableSmogonSets(data.smogon, {pokedex: data.pokedex, moves: data.moves ?? {}});
}

function checkSource(source: string): asserts source is SetSource {
  if (source !== 'smogon' && source !== 'randbats') throw new TeamAssemblyError(`unsupported set source '${source}'; expected 'smogon' or 'randbats'`);
}

function checkTeamShape(species: readonly string[]): void {
  if (species.length !== TEAM_SIZE) throw new TeamAssemblyError(`team must contain exactly ${TEAM_SIZE} species`);
  if (new Set(species).size !== TEAM_SIZE) throw new TeamAssemblyError('team violates Species Clause');
}

/** A six-member, fixed-level Showdown export (override > source set > randbats). */
export function assembleTeam(drafted: readonly string[], data: AssemblyData, rng: WeightedRng = defaultRng): string {
  checkTeamShape(drafted);
  const source = data.source ?? DEFAULT_SET_SOURCE;
  checkSource(source);
  const randbats = loadRandomBattleSets(data.randbats);
  const smogon = usableSmogon(data, source);
  const overrides = data.overrides ?? {};
  const members: string[] = [];
  for (const speciesId of drafted) {
    const override = loadSetOverride(speciesId, overrides);
    if (override !== null) { members.push(normalizeOverrideExport(override)); continue; }
    if (source === 'smogon' && speciesId in smogon) { members.push(selectSmogonSet(speciesId, smogon, rng).export); continue; }
    const entry = data.pokedex[speciesId];
    if (!entry) throw new TeamAssemblyError(`unknown species: ${speciesId}`);
    members.push(exportMember(String(entry.name ?? speciesId), selectRandomBattleSet(speciesId, randbats, rng)));
  }
  return members.join('\n\n');
}

export interface SelectableSet {
  setId: string;
  source: 'override' | 'smogon' | 'randbats';
  label: string;
  item: string;
  ability: string;
  moves: string[];
  export: string;
  isMega: boolean;
  megaForme: string | null;
}

const normalizeItem = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Drop a set's nickname, keeping the species and any gender marker. */
export function stripExportNickname(firstLine: string): string {
  const match = /^(.*?)\s*\(([^)]+)\)(.*)$/.exec(firstLine);
  if (match && match[1].trim() && !['m', 'f'].includes(match[2].trim().toLowerCase())) return `${match[2].trim()}${match[3]}`;
  return firstLine;
}

/** Strip the nickname + inert Tera line and guarantee a `Level: 100` line. */
export function normalizeOverrideExport(exportText: string): string {
  const lines = exportText.split('\n').filter((l) => !l.trim().toLowerCase().startsWith('tera type:')).map((l) => l.trimEnd());
  if (lines.length) lines[0] = stripExportNickname(lines[0]);
  if (!lines.some((l) => l.trim().toLowerCase().startsWith('level:'))) lines.splice(1, 0, `Level: ${FIXED_LEVEL}`);
  return lines.join('\n').trim();
}

export function megaFormeForItem(speciesId: string, item: string, pokedex: Pokedex): string | null {
  const key = normalizeItem(item);
  if (!key) return null;
  for (const suffix of ['mega', 'megax', 'megay']) {
    const forme = `${speciesId}${suffix}`;
    const entry = pokedex[forme];
    if (entry && normalizeItem(String(entry.requiredItem ?? '')) === key) return forme;
  }
  return null;
}

function overrideLabel(megaForme: string | null, index: number): string {
  if (megaForme === null) return `Custom ${index + 1}`;
  if (megaForme.endsWith('megax')) return 'Mega X';
  if (megaForme.endsWith('megay')) return 'Mega Y';
  return 'Mega';
}

export interface SelectableSetsInputs {
  smogonSets: Record<string, SmogonSet[]>;
  randbatsSets: Record<string, RandomBattleSet[]>;
  pokedex: Pokedex;
  setSource?: SetSource;
  overrides?: Overrides;
}

/** Every set a player may choose for one drafted species: overrides plus the active source's sets. */
export function selectableSets(speciesId: string, inputs: SelectableSetsInputs): SelectableSet[] {
  const {pokedex} = inputs;
  const setSource = inputs.setSource ?? 'smogon';
  const speciesName = String(pokedex[speciesId]?.name ?? speciesId);
  const options: SelectableSet[] = [];

  loadSetOverrides(speciesId, inputs.overrides ?? {}).forEach((block, index) => {
    const member = parseShowdownExport(block, {expectedMembers: 1, source: speciesId})[0];
    const megaForme = megaFormeForItem(speciesId, member.item, pokedex);
    // A set's nickname is its author-given label; fall back to Custom/Mega.
    // Compared by id: the reference layer compared against the (lowercase)
    // pokedex name, so an unlabelled `Charizard @ ...` block was labelled
    // "Charizard" instead of "Mega X". The id comparison is the intent.
    const nickname = member.name || '';
    const label = nickname && toId(nickname) !== speciesId ? nickname : overrideLabel(megaForme, index);
    options.push({
      setId: `override:${index}`, source: 'override', label, item: member.item, ability: member.ability,
      moves: [...member.moves], export: normalizeOverrideExport(block), isMega: megaForme !== null, megaForme,
    });
  });

  const speciesSmogon = setSource === 'smogon' ? inputs.smogonSets[speciesId] : undefined;
  if (speciesSmogon && speciesSmogon.length) {
    speciesSmogon.forEach((set, index) => {
      const megaForme = megaFormeForItem(speciesId, set.item, pokedex);
      options.push({
        setId: `smogon:${index}`, source: 'smogon', label: set.label, item: set.item, ability: set.ability,
        moves: [...set.moves], export: set.export, isMega: megaForme !== null, megaForme,
      });
    });
  } else {
    (inputs.randbatsSets[speciesId] ?? []).forEach((set, index) => {
      const megaForme = megaFormeForItem(speciesId, set.item, pokedex);
      options.push({
        setId: `randbats:${index}`, source: 'randbats', label: `Random set ${index + 1}`, item: set.item, ability: set.ability,
        moves: [...set.moves], export: exportMember(speciesName, set), isMega: megaForme !== null, megaForme,
      });
    });
  }

  // Drop a source set that an override already duplicates, so the loadout
  // doesn't show the same set twice. Overrides are always kept.
  const overrideSignatures = new Set(options.filter((o) => o.source === 'override').map(setSignature));
  return options.filter((o) => o.source === 'override' || !overrideSignatures.has(setSignature(o)));
}

/** Item + ability + moveset identity, robust to formatting/nickname/EVs. */
function setSignature(option: SelectableSet): string {
  return JSON.stringify([normalizeItem(option.item), normalizeItem(option.ability), option.moves.map(normalizeItem).sort()]);
}

/** Assemble a team from an ordered species -> setId selection; unknown setIds fall back to the first option. */
export function assembleLoadout(loadout: Record<string, string>, data: AssemblyData): string {
  const species = Object.keys(loadout);
  checkTeamShape(species);
  const source = data.source ?? DEFAULT_SET_SOURCE;
  checkSource(source);
  const randbatsSets = loadRandomBattleSets(data.randbats);
  const smogonSets = usableSmogon(data, source);
  const members: string[] = [];
  for (const [speciesId, setId] of Object.entries(loadout)) {
    const options = selectableSets(speciesId, {smogonSets, randbatsSets, pokedex: data.pokedex, setSource: source, overrides: data.overrides});
    if (!options.length) throw new TeamAssemblyError(`no selectable sets for ${speciesId}`);
    members.push((options.find((o) => o.setId === setId) ?? options[0]).export);
  }
  return members.join('\n\n');
}
