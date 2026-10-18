// Pure six-round draft mechanics built on the legality matrix. Port of rollmons/draft.py.
import {draftConfig, type DraftConfig} from './draft-config.ts';
import {CellMap, sameCell, selectSpecies, selectionProbabilities, selectionWeight, type Cell, type LegalityData} from './legality-matrix.ts';
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
  candidates: string[];
  suggestedSpecies: string;
  selectionProbabilities: Map<string, number>;
  skipsRemaining: number;
  thinRerollAvailable: boolean;
}

export interface DraftOptions {
  rng?: DraftRng;
  config?: Partial<DraftConfig>;
}

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
    if (!this.offer.thinRerollAvailable) throw new ThinRerollUnavailableError('thin-cell reroll requires an offer with 1-2 candidates');
    this.offer = this.rollOffer(this.offer.cell);
    return this.offer;
  }

  private undraftedCandidates(cell: Cell): string[] {
    const drafted = new Set(this.picked);
    return (this.data.matrix.get(cell) ?? []).filter((id) => !drafted.has(id));
  }

  private offerCandidates(candidates: string[]): string[] {
    if (candidates.length <= this.config.candidateCap) return candidates;
    const remaining = [...candidates];
    const offered: string[] = [];
    const weights = {legendaryWeight: this.config.legendaryWeight, arceusWeight: this.config.arceusWeight};
    while (remaining.length && offered.length < this.config.candidateCap) {
      const selected = this.rng.weightedChoice(remaining, remaining.map((id) => selectionWeight(this.data.species[id], weights)));
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
    const cellCandidates = this.undraftedCandidates(cell);
    const offered = this.offerCandidates(cellCandidates);
    const single = new CellMap([[cell, offered]]);
    const weights = {legendaryWeight: this.config.legendaryWeight, arceusWeight: this.config.arceusWeight};
    return {
      roundNumber: this.picked.length + 1,
      cell,
      candidates: offered,
      suggestedSpecies: selectSpecies(cell, single, this.data.species, {...weights, rng: this.rng}),
      selectionProbabilities: selectionProbabilities(cell, single, this.data.species, weights),
      skipsRemaining: this.skips,
      thinRerollAvailable: cellCandidates.length < this.config.thinCellThreshold,
    };
  }
}
