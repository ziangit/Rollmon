// Playtest-tunable draft mechanics (docs/ROADMAP.md §1, decided 2026-10-21).
// The Python reference (rollmons/draft_config.py) still carries the pre-§1
// weights; this is the implementation.

export interface DraftConfig {
  /** species shown per offer */
  candidateCap: number;
  /** per-slot odds of rolling a common / uncommon / rare / legendary candidate */
  rarityOdds: readonly [number, number, number, number];
  /** a cell is filled with visitors from the nearest generations of the same type until it has this many candidates … */
  backfillMin: number;
  /** … and this many non-legendary candidates, so a legendary is never forced into the offer */
  backfillMinNonLegendary: number;
  manualSkipCount: number;
  /** a cell with fewer natives than this grants a free reroll */
  thinCellThreshold: number;
}

export const DEFAULT_DRAFT_CONFIG: Readonly<DraftConfig> = Object.freeze({
  candidateCap: 5,
  rarityOdds: Object.freeze([50, 28, 12, 10] as [number, number, number, number]),
  backfillMin: 6,
  backfillMinNonLegendary: 5,
  manualSkipCount: 2,
  thinCellThreshold: 3,
});

export function draftConfig(overrides: Partial<DraftConfig> = {}): DraftConfig {
  const config = {...DEFAULT_DRAFT_CONFIG, ...overrides};
  if (config.candidateCap < 1) throw new RangeError('candidateCap must be positive');
  if (config.rarityOdds.length !== 4 || config.rarityOdds.some((o) => !(o >= 0)) || !(config.rarityOdds.reduce((a, b) => a + b, 0) > 0)) {
    throw new RangeError('rarityOdds needs four non-negative odds with a positive total');
  }
  if (config.backfillMin < 1) throw new RangeError('backfillMin must be positive');
  if (config.backfillMinNonLegendary < 0) throw new RangeError('backfillMinNonLegendary cannot be negative');
  if (config.manualSkipCount < 0) throw new RangeError('manualSkipCount cannot be negative');
  if (config.thinCellThreshold < 1) throw new RangeError('thinCellThreshold must be positive');
  return config;
}
