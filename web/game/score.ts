// Leaderboard score for a campaign run (docs/ROADMAP.md §7). Pure: the
// numbers here are playtest knobs. Only wins count; the band of each battle
// comes from the campaign structure; a light speed bonus; and a team handicap
// from the drafted species' Showdown tiers so a six-legendary team cannot top
// the board.
import {CAMPAIGN_STRUCTURE} from './pool.ts';

/** Points for winning a battle of each campaign band. */
export const BAND_POINTS: Readonly<Record<string, number>> = Object.freeze({level_1: 1, level_2: 2, level_3: 3, middle: 5, advanced: 8, level_10: 15});
/** Turn count at or above which there is no speed bonus. */
export const SPEED_BONUS_TURNS = 30;
export const SPEED_BONUS_MAX = 0.25;
/** Per-species cost factor by Showdown tier (BL tiers count as the tier above). */
export const TIER_COST: Readonly<Record<string, number>> = Object.freeze({
  AG: 0.5, Uber: 0.5,
  OU: 0.8, UUBL: 0.8,
  UU: 1.0, RUBL: 1.0,
  RU: 1.15, NUBL: 1.15,
  NU: 1.3, PUBL: 1.3,
  PU: 1.5, ZUBL: 1.5, ZU: 1.5, NFE: 1.5, LC: 1.5, 'LC Uber': 1.5,
});
/** Integer score = base × handicap × SCALE, rounded. */
export const SCORE_SCALE = 10;

/** Band (pool tier) of the n-th campaign battle, 0-based. */
export function campaignBand(index: number, structure = CAMPAIGN_STRUCTURE): string {
  let i = index;
  for (const [tier, count] of structure) {
    if (i < count) return tier;
    i -= count;
  }
  throw new RangeError(`battle index ${index} is outside the ${structure.length}-band campaign`);
}

export function speedBonus(turns: number): number {
  const frac = Math.min(1, Math.max(0, (SPEED_BONUS_TURNS - turns) / SPEED_BONUS_TURNS));
  return 1 + SPEED_BONUS_MAX * frac;
}

/** Cost factor for one species; untiered species fall back to base stat total. */
export function costFactor(tier: string | undefined, baseStatTotal: number): number {
  if (tier && tier in TIER_COST) return TIER_COST[tier];
  if (baseStatTotal > 600) return 0.5;
  if (baseStatTotal > 540) return 0.8;
  if (baseStatTotal > 480) return 1.0;
  if (baseStatTotal > 420) return 1.3;
  return 1.5;
}

export interface ScoredSpecies { speciesId: string; tier?: string; baseStatTotal: number }

export function teamHandicap(team: ScoredSpecies[]): number {
  if (!team.length) throw new RangeError('a team is needed for the handicap');
  return team.reduce((s, p) => s + costFactor(p.tier, p.baseStatTotal), 0) / team.length;
}

export interface BattleScore { index: number; band: string; won: boolean; turns: number; points: number; speedBonus: number }
export interface RunScore {
  total: number;
  /** Σ points × speed bonus over won battles, before the handicap */
  base: number;
  handicap: number;
  battles: BattleScore[];
  /** tiebreakers, in order */
  wins: number;
}

export function scoreRun(results: {winner: 'player' | 'boss' | 'tie'; turns: number}[], team: ScoredSpecies[]): RunScore {
  const handicap = teamHandicap(team);
  const battles = results.map((r, index) => {
    const band = campaignBand(index);
    const won = r.winner === 'player';
    const bonus = speedBonus(r.turns);
    return {index, band, won, turns: r.turns, points: won ? BAND_POINTS[band] : 0, speedBonus: won ? bonus : 1};
  });
  const base = battles.reduce((s, b) => s + b.points * b.speedBonus, 0);
  return {total: Math.round(base * handicap * SCORE_SCALE), base, handicap, battles, wins: battles.filter((b) => b.won).length};
}
