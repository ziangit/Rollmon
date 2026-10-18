// Writes data/species-names.json: Chinese (Simplified) and Japanese species
// names by National Dex number, from PokeAPI's pokemon_species_names.csv
// (BSD-3-Clause; the names themselves are Nintendo's). Used by the page's
// language switch (docs/ROADMAP.md §9). Formes keep an English suffix.
//   node scripts/species-names.ts <path/to/pokemon_species_names.csv>
import {readFileSync, writeFileSync} from 'node:fs';
import {REPO_ROOT} from './load-engine.ts';

const csv = process.argv[2];
if (!csv) throw new Error('usage: node scripts/species-names.ts <pokemon_species_names.csv>');
const LANG: Record<string, 'zh' | 'ja'> = {12: 'zh', 11: 'ja'}; // PokeAPI language ids: zh-hans, ja
const names: Record<string, {zh?: string; ja?: string}> = {};
for (const line of readFileSync(csv, 'utf8').split('\n').slice(1)) {
  if (!line.trim()) continue;
  const [num, lang, name] = line.split(',');
  const key = LANG[lang];
  if (!key) continue;
  (names[num] ??= {})[key] = name;
}
const out = `${REPO_ROOT}data/species-names.json`;
writeFileSync(out, JSON.stringify(names) + '\n');
console.log(`${Object.keys(names).length} species -> ${out}`);
