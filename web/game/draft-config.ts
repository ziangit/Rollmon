// Playtest-tunable draft mechanics (port of rollmons/draft_config.py). The
// Python layer read env-var overrides; in the browser these are plain
// values the UI (or a scenario) passes in.

export interface DraftConfig {
  candidateCap: number;
  legendaryWeight: number;
  arceusWeight: number;
  manualSkipCount: number;
  thinCellThreshold: number;
}

export const DEFAULT_DRAFT_CONFIG: Readonly<DraftConfig> = Object.freeze({
  candidateCap: 5,
  legendaryWeight: 0.10,
  arceusWeight: 0.05,
  manualSkipCount: 2,
  thinCellThreshold: 3,
});

export function draftConfig(overrides: Partial<DraftConfig> = {}): DraftConfig {
  const config = {...DEFAULT_DRAFT_CONFIG, ...overrides};
  if (config.candidateCap < 1) throw new RangeError('candidateCap must be positive');
  if (!(config.legendaryWeight > 0)) throw new RangeError('legendaryWeight must be greater than zero');
  if (!(config.arceusWeight > 0)) throw new RangeError('arceusWeight must be greater than zero');
  if (config.manualSkipCount < 0) throw new RangeError('manualSkipCount cannot be negative');
  if (config.thinCellThreshold < 1) throw new RangeError('thinCellThreshold must be positive');
  return config;
}
