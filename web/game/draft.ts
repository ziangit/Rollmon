// Six-round draft mechanics built on the legality matrix (docs/ROADMAP.md §1,
// design decided 2026-10-21). Each round rolls a cell; the cell's natives are
// joined by visitors from the nearest generations of the same type until the
// pool has `backfillMin` candidates and `backfillMinNonLegendary` that are not
// legendary; each of the `candidateCap` offer slots then rolls a rarity from
// `rarityOdds` (falling down to the next lower rarity the pool still has) and
// a species uniformly within it. The Python reference (rollmons/draft.py)
// still implements the pre-§1 weighting.
import {draftConfig, type DraftConfig} from './draft-config.ts';
import {COMMON, LEGENDARY, sameCell, type Cell, type LegalityData, type Rarity} from './legality-matrix.ts';
import {defaultRng, type ChoiceRng, type WeightedRng} from './rng.ts';

export const TEAM_SIZE = 6;
export type DraftRng = ChoiceRng & WeightedRng;

export class DraftError extends Error {}
export class DraftCompleteError extends DraftError {}
export class InvalidPickError extends DraftError {}
export class NoSkipsRemainingError extends DraftError {}
export class ThinRerollUnavailableError extends DraftError {}
export class DraftPoolExhaustedError extends DraftError {}

export interface DraftOffer {
  roundNumber: number;
  cell: Cell;
  /** offered species, sorted */
  candidates: string[];
  /** offered species that are not native to the cell (same type, another generation) */
  visitors: string[];
  /** a uniformly drawn candidate, for automated play */
  suggestedSpecies: string;
  skipsRemaining: number;
  thinRerollAvailable: boolean;
}

export interface DraftOptions {
  rng?: DraftRng;
  config?: Partial<DraftConfig>;
}

const RARITIES: readonly Rarity[] = [0, 1, 2, 3];

/** Stateful draft that exposes offers while leaving picks to the chooser. */
export class Draft {
  private readonly data: LegalityData;
  private readonly rng: DraftRng;
  private readonly config: DraftConfig;
  private skips: number;
  private readonly picked: string[] = [];
  private offer: DraftOffer | null;

  constructor(legalityData: LegalityData, opts: DraftOptions = {}) {
    this.config = draftConfig(opts.config);
    const available = new Set(legalityData.matrix.entries().flatMap(([, s]) => s));
    if (available.size < TEAM_SIZE) throw new DraftPoolExhaustedError(`draft requires ${TEAM_SIZE} unique species, found ${available.size}`);
    this.data = legalityData;
    this.rng = opts.rng ?? defaultRng;
    this.skips = this.config.manualSkipCount;
    this.offer = this.rollOffer();
  }

  get picks(): string[] { return [...this.picked]; }
  get skipsRemaining(): number { return this.skips; }
  get complete(): boolean { return this.picked.length === TEAM_SIZE; }
  get currentOffer(): DraftOffer | null { return this.offer; }

  submitPick(speciesId: string): DraftOffer | null {
    if (this.complete || !this.offer) throw new DraftCompleteError('draft is already complete');
    if (!this.offer.candidates.includes(speciesId)) throw new InvalidPickError(`${speciesId} is not eligible for ${this.offer.cell.join('/')}`);
    this.picked.push(speciesId);
    this.offer = this.complete ? null : this.rollOffer();
    return this.offer;
  }

  useSkip(): DraftOffer {
    if (this.complete) throw new DraftCompleteError('draft is already complete');
    if (this.skips <= 0) throw new NoSkipsRemainingError('no skips remaining');
    const previous = this.offer?.cell ?? null;
    this.skips -= 1;
    this.offer = this.rollOffer(previous);
    return this.offer;
  }

  useThinReroll(): DraftOffer {
    if (this.complete || !this.offer) throw new DraftCompleteError('draft is already complete');
    if (!this.offer.thinRerollAvailable) throw new ThinRerollUnavailableError('thin-cell reroll requires an offer with 1-2 natives');
    this.offer = this.rollOffer(this.offer.cell);
    return this.offer;
  }

  private rarity(id: string): Rarity { return this.data.species[id]?.rarity ?? COMMON; }

  private undraftedCandidates(cell: Cell): string[] {
    const drafted = new Set(this.picked);
    return (this.data.matrix.get(cell) ?? []).filter((id) => !drafted.has(id));
  }

  /** Natives plus visitors from the nearest generations of the same type, until the floors are met. */
  private backfill(cell: Cell, natives: string[]): string[] {
    const pool = [...natives];
    const filled = () => pool.length >= this.config.backfillMin
      && pool.filter((id) => this.rarity(id) !== LEGENDARY).length >= this.config.backfillMinNonLegendary;
    for (let distance = 1; !filled() && distance <= 8; distance++) {
      const visitors = [cell[1] - distance, cell[1] + distance]
        .flatMap((generation) => this.undraftedCandidates([cell[0], generation]))
        .filter((id) => !pool.includes(id));
      while (visitors.length && !filled()) {
        const pick = this.rng.choice(visitors);
        visitors.splice(visitors.indexOf(pick), 1);
        pool.push(pick);
      }
    }
    return pool;
  }

  /** Fill the offer slots: roll a rarity per slot, fall down to one the pool has, draw uniformly within it. */
  private offerCandidates(pool: string[]): string[] {
    if (pool.length <= this.config.candidateCap) return [...pool].sort();
    const remaining = [...pool];
    const offered: string[] = [];
    while (remaining.length && offered.length < this.config.candidateCap) {
      const present = new Set(remaining.map((id) => this.rarity(id)));
      let rarity: number = this.rng.weightedChoice(RARITIES, this.config.rarityOdds);
      while (!present.has(rarity as Rarity) && rarity > COMMON) rarity -= 1;
      while (!present.has(rarity as Rarity)) rarity += 1;
      const bucket = remaining.filter((id) => this.rarity(id) === rarity);
      const selected = this.rng.choice(bucket);
      offered.push(selected);
      remaining.splice(remaining.indexOf(selected), 1);
    }
    return offered.sort();
  }

  private fillableCells(): Cell[] {
    return this.data.matrix.cells().filter((cell) => this.undraftedCandidates(cell).length > 0);
  }

  private rollOffer(excludeCell: Cell | null = null): DraftOffer {
    const fillable = this.fillableCells();
    if (!fillable.length) throw new DraftPoolExhaustedError(`no undrafted species remain before round ${this.picked.length + 1}`);
    const alternatives = fillable.filter((cell) => !sameCell(cell, excludeCell));
    const cell = this.rng.choice(alternatives.length ? alternatives : fillable);
    const natives = this.undraftedCandidates(cell);
    const offered = this.offerCandidates(this.backfill(cell, natives));
    return {
      roundNumber: this.picked.length + 1,
      cell,
      candidates: offered,
      visitors: offered.filter((id) => !natives.includes(id)),
      suggestedSpecies: this.rng.choice(offered),
      skipsRemaining: this.skips,
      thinRerollAvailable: natives.length < this.config.thinCellThreshold,
    };
  }
}
