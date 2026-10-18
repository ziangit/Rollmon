// Writes data/tiers.json: each pokedex species' Showdown tier from the latest
// generation where it had one (docs/ROADMAP.md §7: the leaderboard's team
// handicap). Species absent from gen9 fall back to the last generation they
// were legal in (Nidoking: UU in gen8; Raticate: ZU in gen7).
//   node scripts/tiers.ts
import {readFileSync, writeFileSync} from 'node:fs';
import {Dex} from '@pkmn/sim';
import {REPO_ROOT} from './load-engine.ts';

const NOT_A_TIER = new Set(['Illegal', 'CAP', 'CAP LC', 'CAP NFE', '']);
const pokedex = JSON.parse(readFileSync(`${REPO_ROOT}data/pokedex.json`, 'utf8')) as Record<string, {num: number}>;
const tiers: Record<string, string> = {};
const byTier: Record<string, number> = {};
let fromOlderGen = 0;
for (const [id, entry] of Object.entries(pokedex)) {
  if (entry.num <= 0) continue;
  for (let gen = 9; gen >= 1; gen--) {
    const s = Dex.forGen(gen).species.get(id);
    const tier = s.tier.replace(/[()]/g, ''); // "(OU)" = OU by usage
    if (!s.exists || s.isNonstandard || NOT_A_TIER.has(tier)) continue;
    tiers[id] = tier;
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    if (gen < 9) fromOlderGen++;
    break;
  }
}
const out = `${REPO_ROOT}data/tiers.json`;
writeFileSync(out, JSON.stringify(tiers, Object.keys(tiers).sort(), 0) + '\n');
console.log(`${Object.keys(tiers).length} species tiered (${fromOlderGen} from an older generation) -> ${out}`);
console.log(Object.entries(byTier).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(' '));
