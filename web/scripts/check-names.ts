// Every species/move/item/ability in the repo's team files and in the usable
// Smogon sets must be known to the engine; unknown names parse silently to a
// default and corrupt the search.
//   node scripts/check-names.ts
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {Teams, toID} from '@pkmn/sim';
import {loadUsableSmogonSets} from '../game/smogon-sets.ts';
import {loadGameData} from './game-data.ts';
import {loadEngine, REPO_ROOT} from './load-engine.ts';

function* txtFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* txtFiles(p);
    else if (name.endsWith('.txt')) yield p;
  }
}

const engine = await loadEngine();
const seen = {species: new Map<string, string>(), move: new Map<string, string>(), item: new Map<string, string>(), ability: new Map<string, string>()};
let files = 0;
for (const dir of ['bosses', 'pool', 'sets']) {
  for (const file of txtFiles(`${REPO_ROOT}rollmons/${dir}`)) {
    const team = Teams.import(readFileSync(file, 'utf8'));
    if (!team) { console.log(`unparseable: ${file}`); continue; }
    files++;
    for (const set of team) {
      seen.species.set(toID(set.species).toUpperCase(), file);
      if (set.item) seen.item.set(toID(set.item).toUpperCase(), file);
      if (set.ability) seen.ability.set(toID(set.ability).toUpperCase(), file);
      for (const m of set.moves) seen.move.set(toID(m).toUpperCase(), file);
    }
  }
}
const data = loadGameData();
let smogonSets = 0;
for (const [id, sets] of Object.entries(loadUsableSmogonSets(data.smogon, {pokedex: data.pokedex, moves: data.moves}))) {
  for (const set of sets) {
    smogonSets++;
    const where = `rollmons/data/smogon_sets.json (${set.label})`;
    seen.species.set(id.toUpperCase(), where);
    if (set.item) seen.item.set(toID(set.item).toUpperCase(), where);
    if (set.ability) seen.ability.set(toID(set.ability).toUpperCase(), where);
    for (const m of set.moves) seen.move.set(toID(m).toUpperCase(), where);
  }
}
let bad = 0;
for (const kind of ['species', 'move', 'item', 'ability'] as const) {
  const names = [...seen[kind].keys()];
  const unknown: string[] = JSON.parse(engine.unknown_names(kind, names.join(',')));
  console.log(`${kind}: ${names.length} distinct, ${unknown.length} unknown`);
  // Unknown items only cost search accuracy (the engine treats them as no
  // item); unknown species/moves/abilities corrupt the state, so they fail.
  for (const u of unknown) { if (kind !== 'item') bad++; console.log(`  ${kind === 'item' ? 'warn' : 'FAIL'} ${u}  (${seen[kind].get(u)?.replace(REPO_ROOT, '')})`); }
}
console.log(`${files} team files and ${smogonSets} Smogon sets checked`);
if (bad) process.exitCode = 1;
