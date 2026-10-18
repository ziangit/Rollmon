// Everything the pure layer reads, as one bundle. Node fills it from the repo
// (scripts/game-data.ts); the browser fetches the JSON the build emits.
import type {Bosses} from './bosses.ts';
import type {Pokedex} from './legality-matrix.ts';
import type {Pool} from './pool.ts';
import type {SmogonJson} from './smogon-sets.ts';
import type {Overrides, RandbatsJson} from './team-assembly.ts';

export interface GameData {
  pokedex: Pokedex;
  moves: Record<string, unknown>;
  randbats: RandbatsJson;
  smogon: SmogonJson;
  /** rollmons/sets/<stem>.txt */
  overrides: Overrides;
  /** rollmons/pool/<tier>/<stem>.txt */
  pool: Pool;
  /** rollmons/bosses/<stem>.txt */
  bosses: Bosses;
}
