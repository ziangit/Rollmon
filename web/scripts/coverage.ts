// Draft pool coverage audit: which fully evolved species are not draftable,
// and how often the legendary down-weight can actually apply (docs/ROADMAP.md §1, §6).
//   node scripts/coverage.ts [--list]   (scripts/smogon-scrape.ts fills the gaps from Smogon)
import {createGameContext} from '../app/session.ts';
import {loadGameData} from './game-data.ts';
import {missingSpecies} from './missing-species.ts';

const data = loadGameData();
const ctx = createGameContext(data);
const atoms = new Set(ctx.legality.atoms);

const missing = missingSpecies(data, ctx);
const species = missing.filter((m) => !m.forme);
const band = (lo: number, hi: number) => species.filter((m) => m.bst > lo && m.bst <= hi).length;
console.log(`draftable atoms: ${atoms.size}; fully evolved species not draftable: ${species.length} (plus ${missing.length - species.length} alternate formes)`);
console.log(`  BST ≤500: ${band(0, 500)}   501–600: ${band(500, 600)}   >600: ${band(600, 9999)}`);
console.log('  strongest missing:', species.slice(0, 20).map((m) => `${m.name} (${m.bst})`).join(', '));
if (process.argv.includes('--list')) for (const m of missing) console.log(`  ${m.name}	${m.bst}	${m.types}${m.forme ? '	forme' : ''}`);

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
