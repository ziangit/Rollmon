// Authored boss teams stored as Showdown export text, keyed by file stem.
// Port of rollmons/boss_loader.py.
import {titleCase} from './showdown-export.ts';

export type Bosses = Record<string, string>;

export class BossTeamError extends Error {}

function normalizedBossId(bossId: string): string {
  const id = bossId.endsWith('.txt') ? bossId.slice(0, -4) : bossId;
  if (!id || id === '.' || id === '..' || /[\\/]/.test(id)) throw new BossTeamError(`invalid boss ID: ${bossId}`);
  return id;
}

export function loadBossTeam(bossId: string, bosses: Bosses): string {
  const id = normalizedBossId(bossId);
  const text = bosses[id];
  if (text === undefined) throw new BossTeamError(`unknown boss: ${bossId}`);
  const trimmed = text.trim();
  if (!trimmed) throw new BossTeamError(`boss team is empty: ${bossId}`);
  return trimmed;
}

export function bossDisplayName(bossId: string, bosses: Bosses): string {
  const id = normalizedBossId(bossId);
  if (!(id in bosses)) throw new BossTeamError(`unknown boss: ${bossId}`);
  return titleCase(id.replaceAll('-', ' ').replaceAll('_', ' '));
}

/** Sorted boss IDs with "ash" first when present. */
export function listBossIds(bosses: Bosses): string[] {
  return Object.keys(bosses).sort().sort((a, b) => Number(a !== 'ash') - Number(b !== 'ash'));
}
