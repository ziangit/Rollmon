// Draft pool coverage audit: which fully evolved species are not draftable,
// and how often the legendary down-weight can actually apply (docs/ROADMAP.md §1, §6).
//   node scripts/coverage.ts [--list]
import {createGameContext} from '../app/session.ts';
import {loadGameData} from './game-data.ts';

const data = loadGameData();
const ctx = createGameContext(data);
const dex = data.pokedex as Record<string, any>;
const atoms = new Set(ctx.legality.atoms);

const missing: {name: string; bst: number; types: string}[] = [];
const seen = new Set<string>();
let fullyEvolved = 0;
for (const [id, e] of Object.entries(dex)) {
  if (e.num <= 0 || (e.evos && e.evos.length)) continue;
  // battle-only and item/ability/move-locked formes (Mega, Primal, Crowned, ...)
  if (e.battleOnly || e.requiredItem || e.requiredAbility || e.requiredMove) continue;
  if (/gmax|totem|cosplay|starter|spiky/.test(id)) continue;
  if (e.isNonstandard && e.isNonstandard !== 'Past') continue;
  if (e.baseSpecies && dex[e.baseSpecies.toLowerCase().replace(/[^a-z0-9]/g, '')]?.cosmeticFormes?.includes(e.name)) continue;
  if (seen.has(e.name)) continue;
  seen.add(e.name);
  fullyEvolved++;
  if (!atoms.has(id)) {
    const bst = Object.values(e.baseStats as Record<string, number>).reduce((a, b) => a + b, 0);
    missing.push({name: e.name, bst, types: e.types.join('/')});
  }
}
missing.sort((a, b) => b.bst - a.bst);
const band = (lo: number, hi: number) => missing.filter((m) => m.bst > lo && m.bst <= hi).length;
console.log(`draftable atoms: ${atoms.size}; fully evolved non-battle-only species: ${fullyEvolved}; not draftable: ${missing.length}`);
console.log(`  BST ≤500: ${band(0, 500)}   501–600: ${band(500, 600)}   >600: ${band(600, 9999)}`);
console.log('  strongest missing:', missing.slice(0, 20).map((m) => `${m.name} (${m.bst})`).join(', '));
if (process.argv.includes('--list')) for (const m of missing) console.log(`  ${m.name}\t${m.bst}\t${m.types}`);

let small = 0, thin = 0, withLegendary = 0, guaranteed = 0, legendaries = 0;
const guaranteedNames: string[] = [];
for (const [cell, ids] of ctx.legality.matrix.entries()) {
  const L = ids.filter((i) => ctx.legality.species[i].legendary);
  legendaries += L.length;
  if (L.length) withLegendary++;
  if (ids.length < 3) thin++;
  if (ids.length <= 5) small++;
  if (L.length && ids.length <= 5) { guaranteed++; guaranteedNames.push(`${cell[0]}/gen${cell[1]}: ${L.map((i) => ctx.legality.species[i].name).join('+')} (${ids.length} in cell)`); }
}
console.log(`cells: ${ctx.legality.matrix.size}; ≤5 species (weight never applies): ${small}; <3 (thin reroll): ${thin}`);
console.log(`legendary atoms: ${legendaries} in ${withLegendary} cells; guaranteed in the offer in ${guaranteed} cells:`);
for (const n of guaranteedNames) console.log('  ' + n);
