// Tiered boss pools and the randomized ten-battle campaign. Port of
// rollmons/pool_loader.py; the pool comes in as {tier: {teamId: export}}.
import {defaultRng, type SampleRng} from './rng.ts';

// Ordered (tier, number of battles drawn from it). Sums to a fixed ten-battle
// campaign that climbs in difficulty; "middle" and "advanced" are act bands
// sampled without replacement.
export const CAMPAIGN_STRUCTURE: readonly (readonly [tier: string, count: number])[] = [
  ['level_1', 1], ['level_2', 1], ['level_3', 1], ['middle', 3], ['advanced', 3], ['level_10', 1],
];

export type Pool = Record<string, Record<string, string>>;

export class PoolError extends Error {}

export interface CampaignBattle {
  order: number; // 1-based battle position in the run
  tier: string;
  teamId: string; // file stem, e.g. "Cynthia"
  export: string; // the six-member Showdown export
}

/** Sorted team IDs (file stems) available in one tier. */
export function tierTeams(tier: string, pool: Pool): string[] {
  return Object.keys(pool[tier] ?? {}).sort();
}

export function loadPoolTeam(tier: string, teamId: string, pool: Pool): string {
  const text = pool[tier]?.[teamId];
  if (text === undefined) throw new PoolError(`no team '${teamId}' in tier '${tier}'`);
  return text.trim();
}

/** An ordered campaign: `count` distinct random teams per tier, in tier order. */
export function buildCampaign(pool: Pool, opts: {rng?: SampleRng; structure?: typeof CAMPAIGN_STRUCTURE} = {}): CampaignBattle[] {
  const rng = opts.rng ?? defaultRng;
  const battles: CampaignBattle[] = [];
  let order = 0;
  for (const [tier, count] of opts.structure ?? CAMPAIGN_STRUCTURE) {
    const available = tierTeams(tier, pool);
    if (available.length < count) throw new PoolError(`tier '${tier}' needs ${count} team(s) but has ${available.length}`);
    for (const teamId of rng.sample(available, count)) {
      order += 1;
      battles.push({order, tier, teamId, export: loadPoolTeam(tier, teamId, pool)});
    }
  }
  return battles;
}
