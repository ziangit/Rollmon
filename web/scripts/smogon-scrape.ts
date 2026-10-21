// Fills rollmons/data/smogon_sets.json from Smogon's dex (docs/ROADMAP.md §6).
// For every fully evolved species without a usable set (or the species named
// on the command line) it walks SV, SS, SM, XY, BW, DP, RS in that order and
// keeps the first generation that has sets in a standard singles tier (OU,
// Ubers, UU, RU, NU, PU, ZU, AG, and their National Dex versions). Side
// formats (1v1, Monotype, Doubles, VGC, BSS, Hackmons, STABmons, …) are never
// taken. Sets built around a Z-Crystal are skipped (no Z-Moves in gen 9).
// Hidden Power is dropped (the gen 9 data has no typed Hidden Power, and a
// plain one is a move the battle driver cannot map): the slot takes its next
// option, and a set keeps at least three moves or is skipped.
//   node scripts/smogon-scrape.ts [--dry-run] [speciesId …]
import {readFileSync, writeFileSync} from 'node:fs';
import {createGameContext} from '../app/session.ts';
import {ingestSmogonSets, normalizedFormat, type SmogonRawSet} from '../game/smogon-sets.ts';
import {loadGameData} from './game-data.ts';
import {REPO_ROOT} from './load-engine.ts';
import {missingSpecies} from './missing-species.ts';

const GENERATIONS = ['sv', 'ss', 'sm', 'xy', 'bw', 'dp', 'rs'];
// Standard singles tiers only, in the order sets are kept.
const TIER_ORDER = ['ou', 'uber', 'ubers', 'uu', 'ru', 'nu', 'pu', 'zu', 'ag', 'anything goes', 'ubers uu'];
const ALLOWED = /^(national dex )?(ou|uber|ubers|uu|ru|nu|pu|zu|ag|anything goes|ubers uu)( dlc\d)?$/;
const MAX_SETS_PER_SPECIES = 4;
const STAT_LABELS: Record<string, string> = {hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe'};
const PAUSE_MS = 250;
const FILE = `${REPO_ROOT}rollmons/data/smogon_sets.json`;
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Moveset {
  name: string; pokemon: string; abilities: string[]; items: string[]; natures: string[];
  moveslots: {move: string; type: string | null}[][]; evconfigs: Record<string, number>[]; ivconfigs: Record<string, number>[];
}
interface Strategy { format: string; movesets: Moveset[] }

function formatRank(format: string): number {
  const n = normalizedFormat(format).replace(/^national dex /, '').replace(/ dlc\d$/, '');
  const i = TIER_ORDER.indexOf(n);
  return (i < 0 ? TIER_ORDER.length : i) + (normalizedFormat(format).startsWith('national dex') ? 100 : 0);
}

/** Smogon's page alias: "Mr. Rime" → mr-rime, "Sirfetch’d" → sirfetchd, "Tapu Koko" → tapu-koko. */
function alias(name: string): string {
  return name.toLowerCase().replace(/[’'.%]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function fetchStrategies(gen: string, pageAlias: string): Promise<Strategy[]> {
  const res = await fetch('https://www.smogon.com/dex/_rpc/dump-pokemon', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'User-Agent': 'rollmons set scraper (github.com/ziangit/Rollmon)'},
    body: JSON.stringify({gen, alias: pageAlias, language: 'en'}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${gen}/${pageAlias}`);
  const body = await res.json() as {strategies?: Strategy[]} | null;
  return body?.strategies ?? [];
}

function statLine(prefix: string, cfg: Record<string, number> | undefined, keep: (v: number) => boolean): string | null {
  if (!cfg) return null;
  const parts = Object.entries(STAT_LABELS).filter(([k]) => keep(cfg[k] ?? 0)).map(([k, label]) => `${cfg[k]} ${label}`);
  return parts.length ? `${prefix}: ${parts.join(' / ')}` : null;
}

/** One export block from a Smogon moveset, or null when it cannot be used.
 *  `species` is Smogon's spelling (the checked-in pokedex stores lowercase names). */
function exportBlock(species: string, m: Moveset): string | null {
  const item = m.items.find((i) => !/ium Z$/.test(i)) ?? '';
  if (m.items.length && !item) return null; // Z-Crystal set
  const moves: string[] = [];
  for (const slot of m.moveslots) {
    const pick = slot.find((o) => o.move !== 'Hidden Power' && !moves.includes(o.move));
    if (pick) moves.push(pick.move);
  }
  if (moves.length < Math.min(3, m.moveslots.length)) return null;
  const lines = [item ? `${species} @ ${item}` : species];
  if (m.abilities[0]) lines.push(`Ability: ${m.abilities[0]}`);
  lines.push('Level: 100');
  const evs = statLine('EVs', m.evconfigs[0], (v) => v > 0);
  if (evs) lines.push(evs);
  if (m.natures[0]) lines.push(`${m.natures[0]} Nature`);
  const ivs = statLine('IVs', m.ivconfigs[0], (v) => v !== 31);
  if (ivs) lines.push(ivs);
  for (const move of moves) lines.push(`- ${move}`);
  return lines.join('\n');
}

const dryRun = process.argv.includes('--dry-run');
const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const data = loadGameData();
const dex = data.pokedex as Record<string, {name: string}>;
const targets = requested.length ? requested : missingSpecies(data, createGameContext(data)).map((m) => m.id);
for (const id of targets) if (!dex[id]) throw new Error(`unknown species id: ${id}`);
console.log(`${targets.length} species to look up${dryRun ? ' (dry run)' : ''}`);

const json = JSON.parse(readFileSync(FILE, 'utf8')) as {sets: Record<string, SmogonRawSet[]>; [k: string]: unknown};
const found: Record<string, SmogonRawSet[]> = {};
const none: string[] = [];
for (const id of targets) {
  const name = dex[id].name;
  const pageAlias = alias(name);
  let kept: SmogonRawSet[] = [];
  let where = '';
  for (const gen of GENERATIONS) {
    let strategies: Strategy[];
    try { strategies = await fetchStrategies(gen, pageAlias); } catch (e) { console.log(`  ${name}: ${(e as Error).message}`); continue; }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
    const candidates: SmogonRawSet[] = [];
    for (const s of strategies.filter((s) => ALLOWED.test(normalizedFormat(s.format))).sort((a, b) => formatRank(a.format) - formatRank(b.format))) {
      for (const m of s.movesets) {
        if (toId(m.pokemon).replace(/gmax$/, '') !== id) continue; // another forme on the same page
        const species = m.pokemon.replace(/-Gmax$/, '');
        const block = exportBlock(species, m);
        if (!block) continue;
        candidates.push({label: `${s.format} ${m.name} ${species}`, generation: gen.toUpperCase(), format: s.format, name: m.name, export: block, source_url: `https://www.smogon.com/dex/${gen}/pokemon/${pageAlias}/`});
      }
    }
    // keep only what the game can ingest (known species and moves)
    const [usable] = ingestSmogonSets({sets: {[id]: candidates}}, {pokedex: data.pokedex, moves: data.moves});
    const ok = new Set((usable[id] ?? []).map((u) => u.label));
    kept = candidates.filter((c) => ok.has(String(c.label))).slice(0, MAX_SETS_PER_SPECIES);
    if (kept.length) { where = gen.toUpperCase(); break; }
  }
  if (kept.length) {
    found[id] = kept;
    console.log(`  ${name}: ${kept.length} set(s) from ${where} ${[...new Set(kept.map((k) => k.format))].join('/')}`);
  } else {
    none.push(name);
    console.log(`  ${name}: nothing in a standard tier`);
  }
}

console.log(`\nsets found for ${Object.keys(found).length} species; none for ${none.length}: ${none.join(', ')}`);
if (dryRun) process.exit(0);
for (const [id, sets] of Object.entries(found)) json.sets[id] = sets;
json.sets = Object.fromEntries(Object.entries(json.sets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
json.species_with_sets = Object.keys(json.sets).length;
json.final_species_count = Object.keys(json.sets).length;
writeFileSync(FILE, JSON.stringify(json, null, 2) + '\n');
console.log(`wrote ${FILE.replace(REPO_ROOT, '')}: ${json.species_with_sets} species`);
