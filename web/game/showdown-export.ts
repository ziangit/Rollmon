// Clean-room parser for Pokémon Showdown export text (the Pokepaste format).
// Port of rollmons/showdown_export.py. IDs follow Showdown's convention:
// lowercase ASCII alphanumerics only.

export type StatName = 'hp' | 'attack' | 'defense' | 'special-attack' | 'special-defense' | 'speed';
export type StatTable = Record<StatName, number>;

const STAT_KEYS: Record<string, StatName> = {
  hp: 'hp', atk: 'attack', def: 'defense', spa: 'special-attack', spd: 'special-defense', spe: 'speed',
};
const STAT_NAMES: StatName[] = ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'];
const defaultStats = (value: number): StatTable => Object.fromEntries(STAT_NAMES.map((s) => [s, value])) as StatTable;
const GENDER_SUFFIX = /\s*\((M|F)\)\s*$/;

export interface ExportMember {
  species: string;
  name: string;
  gender: string;
  item: string;
  ability: string;
  level: number;
  nature: string;
  shiny: boolean;
  teraType: string;
  evs: StatTable;
  ivs: StatTable;
  moves: string[];
}

export function toId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseStatLine(payload: string, defaults: StatTable): StatTable {
  const stats = {...defaults};
  for (let part of payload.split('/')) {
    part = part.trim();
    if (!part) continue;
    const space = part.indexOf(' ');
    const amount = space < 0 ? part : part.slice(0, space);
    const stat = space < 0 ? '' : part.slice(space + 1);
    const key = STAT_KEYS[stat.trim().toLowerCase()];
    if (key === undefined || !/^\d+$/.test(amount.trim())) throw new Error(`bad stat entry: '${part}'`);
    stats[key] = Number(amount);
  }
  return stats;
}

/** `Nickname (Species) (G) @ Item` with every part but the name optional. */
function parseHeader(line: string): Pick<ExportMember, 'species' | 'name' | 'gender' | 'item'> {
  const at = line.indexOf('@');
  let head = (at < 0 ? line : line.slice(0, at)).trim();
  const item = at < 0 ? '' : line.slice(at + 1);
  let gender = '';
  const match = GENDER_SUFFIX.exec(head);
  if (match) {
    gender = match[1];
    head = head.slice(0, match.index).trimEnd();
  }
  let nickname = '';
  let species = head;
  if (head.endsWith(')') && head.includes('(')) {
    const open = head.lastIndexOf('(');
    nickname = head.slice(0, open).trim();
    species = head.slice(open + 1, -1).trim();
  }
  if (!species) throw new Error(`export block has no species: '${line}'`);
  return {species: toId(species), name: nickname || species, gender, item: at < 0 ? '' : toId(item)};
}

export function singlePokemonExportToMember(block: string): ExportMember {
  const lines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error('empty export block');
  const member: ExportMember = {
    ...parseHeader(lines[0]),
    ability: '', level: 100, nature: '', shiny: false, teraType: '',
    evs: defaultStats(0), ivs: defaultStats(31), moves: [],
  };
  for (const line of lines.slice(1)) {
    if (line.startsWith('-')) member.moves.push(toId(line.slice(1)));
    else if (line.startsWith('Ability:')) member.ability = toId(line.slice('Ability:'.length));
    else if (line.startsWith('Level:')) {
      const level = line.slice('Level:'.length).trim();
      if (!/^[+-]?\d+$/.test(level)) throw new Error(`bad level: '${level}'`);
      member.level = Number(level);
    } else if (line.startsWith('EVs:')) member.evs = parseStatLine(line.slice('EVs:'.length), defaultStats(0));
    else if (line.startsWith('IVs:')) member.ivs = parseStatLine(line.slice('IVs:'.length), defaultStats(31));
    else if (line.startsWith('Tera Type:')) member.teraType = toId(line.slice('Tera Type:'.length));
    else if (line.startsWith('Shiny:')) member.shiny = line.slice('Shiny:'.length).trim().toLowerCase() === 'yes';
    else if (line.endsWith('Nature')) member.nature = toId(line.slice(0, -'Nature'.length));
    // Unknown lines (Happiness, Gigantamax, comments) are ignored.
  }
  return member;
}

/** Split a full export into blank-line separated blocks. */
export function exportBlocks(exportText: string): string[] {
  return exportText.trim().split(/\n\s*\n/).filter((b) => b.trim());
}

/** Parse a full export (blocks separated by blank lines) into members. */
export function exportToMembers(exportText: string): ExportMember[] {
  return exportBlocks(exportText).map(singlePokemonExportToMember);
}

/** Python's `str.title()`: upper-case a letter that follows a non-letter, lower-case the rest. */
export function titleCase(value: string): string {
  let out = '';
  let prevLetter = false;
  for (const ch of value) {
    const letter = /[A-Za-z]/.test(ch);
    out += letter ? (prevLetter ? ch.toLowerCase() : ch.toUpperCase()) : ch;
    prevLetter = letter;
  }
  return out;
}
