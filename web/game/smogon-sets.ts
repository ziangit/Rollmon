// Ingest contributor-provided Smogon export sets. Port of rollmons/smogon_sets.py.
import {parseShowdownExport, SubmissionError, type EntityData} from './submissions.ts';

export const EXCLUDED_FORMAT_ALIASES = new Set([
  '1v1', '1v 1', '2v2', 'aaa', 'almost any ability', 'battle stadium singles', 'battle spot singles', 'bss', 'doubles', 'godly gift',
  'mix and mega', 'monotype', 'vgc', 'bh', 'balanced hackmons', 'pure hackmons', 'stabmons', 'cap', 'inheritance', 'camomons',
  'partners in crime', 'draft', 'free for all', 'ffa', 'triples',
]);

export interface SmogonRawSet { label?: string; generation?: string; format?: string; name?: string; export?: string; source_url?: string }
export interface SmogonJson { sets: Record<string, SmogonRawSet[]>; [k: string]: unknown }

export interface SmogonSet {
  speciesId: string;
  label: string;
  generation: string;
  format: string;
  name: string;
  export: string;
  sourceUrl: string;
  item: string;
  ability: string;
  moves: string[];
}

export interface ValidationIssue { speciesId: string; label: string; format: string; field: string; value: string; reason: string }

export interface SmogonIngestionReport {
  inputSpeciesCount: number;
  inputSetCount: number;
  formatExcludedSetCount: number;
  matchedFormatStrings: string[];
  usableSpeciesCount: number;
  usableSetCount: number;
  validationIssues: ValidationIssue[];
  noJsonSetSpecies: string[];
  allSetsExcludedOrFailedSpecies: string[];
}

export class SmogonSetDataError extends Error {}

export function normalizedFormat(formatName: string): string {
  return formatName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isFormatExcluded(formatName: string): boolean {
  const n = normalizedFormat(formatName);
  return EXCLUDED_FORMAT_ALIASES.has(n) || n.startsWith('bss ') || n.startsWith('vgc') || n.includes('monotype') || n.includes('hackmons') || n.includes('doubles');
}

/** Remove Tera-only metadata so exports are inert in the no-Tera format. */
export function stripTeraTypeLines(exportText: string): string {
  return exportText.split('\n').filter((l) => !l.trim().toLowerCase().startsWith('tera type:')).join('\n').trim();
}

function validationIssues(args: {speciesId: string; label: string; format: string; exportText: string; data: EntityData}): ValidationIssue[] {
  const {speciesId, label, format, exportText, data} = args;
  const issue = (field: string, value: string, reason: string): ValidationIssue => ({speciesId, label, format, field, value, reason});
  let members;
  try {
    members = parseShowdownExport(exportText, {expectedMembers: 1, source: `${speciesId} ${label}`});
  } catch (err) {
    if (err instanceof SubmissionError) return [issue('export', label, err.message)];
    throw err;
  }
  const member = members[0];
  const issues: ValidationIssue[] = [];
  if (member.species !== speciesId) issues.push(issue('species', member.species, `export species does not match JSON key ${speciesId}`));
  if (!(member.species in data.pokedex)) issues.push(issue('species', member.species, 'species is not implemented in checked-in Gen 9 engine data'));
  for (const move of member.moves) if (!(move in data.moves)) issues.push(issue('move', move, 'move is not implemented in checked-in Gen 9 engine data'));
  return issues;
}

export function ingestSmogonSets(json: SmogonJson, data: EntityData, opts: {comparisonSpecies?: Iterable<string>} = {}): [Record<string, SmogonSet[]>, SmogonIngestionReport] {
  const rawSets = json.sets;
  if (!rawSets || typeof rawSets !== 'object' || Array.isArray(rawSets)) throw new SmogonSetDataError('smogon JSON has no top-level sets mapping');
  const usable: Record<string, SmogonSet[]> = {};
  const matchedFormats = new Set<string>();
  let formatExcluded = 0;
  const issues: ValidationIssue[] = [];
  const allExcludedOrFailed: string[] = [];

  for (const [speciesId, entries] of Object.entries(rawSets)) {
    if (!Array.isArray(entries)) throw new SmogonSetDataError(`${speciesId} sets must be a list`);
    const speciesUsable: SmogonSet[] = [];
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object') throw new SmogonSetDataError(`${speciesId} set must be an object`);
      const format = String(raw.format ?? '');
      if (isFormatExcluded(format)) { matchedFormats.add(format); formatExcluded++; continue; }
      const exportText = stripTeraTypeLines(String(raw.export ?? ''));
      const label = String(raw.label ?? '');
      const found = validationIssues({speciesId, label, format, exportText, data});
      if (found.length) { issues.push(...found); continue; }
      const member = parseShowdownExport(exportText, {expectedMembers: 1, source: `${speciesId} ${label}`})[0];
      speciesUsable.push({
        speciesId, label, generation: String(raw.generation ?? ''), format, name: String(raw.name ?? ''),
        export: exportText, sourceUrl: String(raw.source_url ?? ''), item: member.item, ability: member.ability, moves: [...member.moves],
      });
    }
    if (speciesUsable.length) usable[speciesId] = speciesUsable;
    else allExcludedOrFailed.push(speciesId);
  }

  const comparison = new Set(opts.comparisonSpecies ?? []);
  const report: SmogonIngestionReport = {
    inputSpeciesCount: Object.keys(rawSets).length,
    inputSetCount: Object.values(rawSets).reduce((n, e) => n + e.length, 0),
    formatExcludedSetCount: formatExcluded,
    matchedFormatStrings: [...matchedFormats].sort(),
    usableSpeciesCount: Object.keys(usable).length,
    usableSetCount: Object.values(usable).reduce((n, e) => n + e.length, 0),
    validationIssues: issues,
    noJsonSetSpecies: [...comparison].filter((s) => !(s in rawSets)).sort(),
    allSetsExcludedOrFailedSpecies: allExcludedOrFailed.sort(),
  };
  return [usable, report];
}

export function loadUsableSmogonSets(json: SmogonJson, data: EntityData): Record<string, SmogonSet[]> {
  return ingestSmogonSets(json, data)[0];
}
