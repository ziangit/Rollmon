// Draft pool coverage audit: which fully evolved species are not draftable,
// how the rarity buckets fall, and which cells need visitors or carry many
// legendaries (docs/ROADMAP.md §1, §6).
//   node scripts/coverage.ts [--list]   (scripts/smogon-scrape.ts fills the gaps from Smogon)
import {createGameContext} from '../app/session.ts';
import {LEGENDARY, RARITY_NAMES} from '../game/legality-matrix.ts';
import {loadGameData} from './game-data.ts';
import {missingSpecies} from './missing-species.ts';

const data = loadGameData();
const ctx = createGameContext(data);
const atoms = new Set(ctx.legality.atoms);
const {backfillMin, backfillMinNonLegendary, thinCellThreshold, rarityOdds} = ctx.config;

const missing = missingSpecies(data, ctx);
const species = missing.filter((m) => !m.forme);
const band = (lo: number, hi: number) => species.filter((m) => m.bst > lo && m.bst <= hi).length;
console.log(`draftable atoms: ${atoms.size}; fully evolved species not draftable: ${species.length} (plus ${missing.length - species.length} alternate formes)`);
console.log(`  BST ≤500: ${band(0, 500)}   501–600: ${band(500, 600)}   >600: ${band(600, 9999)}`);
console.log('  strongest missing:', species.slice(0, 20).map((m) => `${m.name} (${m.bst})`).join(', '));
if (process.argv.includes('--list')) for (const m of missing) console.log(`  ${m.name}	${m.bst}	${m.types}${m.forme ? '	forme' : ''}`);

const buckets = [0, 0, 0, 0];
for (const id of atoms) buckets[ctx.legality.species[id].rarity]++;
console.log(`rarity buckets: ${RARITY_NAMES.map((n, i) => `${n} ${buckets[i]}`).join(', ')}; slot odds ${rarityOdds.join('/')}`);

let thin = 0, short = 0, legendaryHeavy = 0, withLegendary = 0;
const heavyNames: string[] = [];
for (const [cell, ids] of ctx.legality.matrix.entries()) {
  const legends = ids.filter((i) => ctx.legality.species[i].rarity === LEGENDARY);
  if (legends.length) withLegendary++;
  if (ids.length < thinCellThreshold) thin++;
  if (ids.length < backfillMin) short++;
  if (ids.length - legends.length < backfillMinNonLegendary && legends.length) {
    legendaryHeavy++;
    heavyNames.push(`${cell[0]}/gen${cell[1]}: ${legends.map((i) => ctx.legality.species[i].name).join('+')} (${ids.length} natives)`);
  }
}
console.log(`cells: ${ctx.legality.matrix.size}; thin (<${thinCellThreshold} natives, free reroll): ${thin}; short (<${backfillMin} natives, visitors fill in): ${short}`);
console.log(`legendaries: ${buckets[LEGENDARY]} in ${withLegendary} cells; cells with fewer than ${backfillMinNonLegendary} non-legendary natives (visitors keep the offer open): ${legendaryHeavy}`);
for (const n of heavyNames) console.log('  ' + n);
