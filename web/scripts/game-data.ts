// Node loader for the pure layer's data bundle (tests, scripts, and the build).
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import type {GameData} from '../game/data.ts';
import {REPO_ROOT} from './load-engine.ts';

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

export function textFilesByStem(dir: string): Record<string, string> {
  let names: string[];
  try { names = readdirSync(dir); } catch { return {}; }
  const out: Record<string, string> = {};
  for (const name of names.sort()) {
    const p = join(dir, name);
    if (name.endsWith('.txt') && statSync(p).isFile()) out[name.slice(0, -4)] = readFileSync(p, 'utf8');
  }
  return out;
}

export function loadGameData(root = REPO_ROOT): GameData {
  const poolDir = `${root}rollmons/pool`;
  const pool: GameData['pool'] = {};
  for (const tier of readdirSync(poolDir).sort()) {
    if (statSync(join(poolDir, tier)).isDirectory()) pool[tier] = textFilesByStem(join(poolDir, tier));
  }
  return {
    pokedex: readJson(`${root}data/pokedex.json`),
    moves: readJson(`${root}data/moves.json`),
    randbats: readJson(`${root}rollmons/data/gen9randombattle.json`),
    smogon: readJson(`${root}rollmons/data/smogon_sets.json`),
    overrides: textFilesByStem(`${root}rollmons/sets`),
    pool,
    bosses: textFilesByStem(`${root}rollmons/bosses`),
    tiers: readJson(`${root}data/tiers.json`),
    speciesNames: readJson(`${root}data/species-names.json`),
  };
}
