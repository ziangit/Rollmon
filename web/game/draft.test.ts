// Ported from tests/test_draft.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Draft, DraftCompleteError, NoSkipsRemainingError, TEAM_SIZE, ThinRerollUnavailableError, type DraftRng} from './draft.ts';
import {CellMap, COMMON, LEGENDARY, RARE, buildLegalityData, type LegalityData, type Rarity, type SpeciesMetadata} from './legality-matrix.ts';
import {seededRng} from './rng.ts';
import {loadGameData} from '../scripts/game-data.ts';

const data = loadGameData();
const legality = () => buildLegalityData(data);

function playSuggestions(draft: Draft) {
  const offers = [];
  while (!draft.complete) {
    const offer = draft.currentOffer!;
    offers.push(offer);
    draft.submitPick(offer.suggestedSpecies);
  }
  return offers;
}

const firstChoiceRng: DraftRng = {choice: (s) => s[0], weightedChoice: (p) => p[0]};
const firstCellWeightedRng = (seed: number): DraftRng => ({choice: (s) => s[0], weightedChoice: seededRng(seed).weightedChoice});
const meta = (id: string, types: string[], opts: {gen?: number; rarity?: Rarity} = {}): SpeciesMetadata =>
  ({speciesId: id, name: id, types, debutGeneration: opts.gen ?? 1, baseStatTotal: 500, rarity: opts.rarity ?? COMMON, legendary: opts.rarity === LEGENDARY});
const dataOf = (species: Record<string, SpeciesMetadata>, matrix: [readonly [string, number], string[]][]): LegalityData =>
  ({atoms: Object.keys(species), species, matrix: new CellMap(matrix)});

test('a full seeded draft completes without duplicates', () => {
  const draft = new Draft(legality(), {rng: seededRng(1001)});
  const offers = playSuggestions(draft);
  assert.equal(offers.length, TEAM_SIZE);
  assert.equal(new Set(draft.picks).size, TEAM_SIZE);
  assert.equal(draft.currentOffer, null);
  assert.throws(() => draft.submitPick(draft.picks[0]), DraftCompleteError);
});

test('a seeded draft is reproducible', () => {
  const first = playSuggestions(new Draft(legality(), {rng: seededRng(90210)}));
  const second = playSuggestions(new Draft(legality(), {rng: seededRng(90210)}));
  assert.deepEqual(first.map((o) => [o.cell, o.suggestedSpecies]), second.map((o) => [o.cell, o.suggestedSpecies]));
});

test('a drafted species is removed from all later offers', () => {
  const draft = new Draft(legality(), {rng: seededRng(77)});
  const firstPick = draft.currentOffer!.suggestedSpecies;
  draft.submitPick(firstPick);
  while (!draft.complete) {
    const offer = draft.currentOffer!;
    assert.ok(!offer.candidates.includes(firstPick));
    draft.submitPick(offer.suggestedSpecies);
  }
});

test('a near-exhausted cell is never offered', () => {
  const ids = ['shared', 'two', 'three', 'four', 'five', 'six'];
  const species = Object.fromEntries(ids.map((id) => [id, meta(id, id === 'shared' ? ['fire', 'water'] : ['water'])]));
  const draft = new Draft(dataOf(species, [[['fire', 1], ['shared']], [['water', 1], ids]]), {rng: firstChoiceRng, config: {manualSkipCount: 0}});
  assert.deepEqual(draft.currentOffer!.cell, ['fire', 1]);
  draft.submitPick('shared');
  while (!draft.complete) {
    const offer = draft.currentOffer!;
    assert.deepEqual(offer.cell, ['water', 1]);
    assert.ok(offer.candidates.length && !offer.candidates.includes('shared'));
    draft.submitPick(offer.candidates[0]);
  }
});

test('skip rerolls the cell and is bounded', () => {
  const draft = new Draft(legality(), {rng: seededRng(14), config: {manualSkipCount: 2}});
  const original = draft.currentOffer!.cell;
  const first = draft.useSkip();
  const second = draft.useSkip();
  assert.notDeepEqual(first.cell, original);
  assert.ok(second.cell);
  assert.equal(draft.skipsRemaining, 0);
  assert.equal(second.skipsRemaining, 0);
  assert.throws(() => draft.useSkip(), NoSkipsRemainingError);
});

const thinData = () => {
  const ids = ['thin', 'two', 'three', 'four', 'five', 'six', 'seven'];
  const species = Object.fromEntries(ids.map((id) => [id, meta(id, id === 'thin' ? ['fire'] : ['water'])]));
  return dataOf(species, [[['fire', 1], ['thin']], [['water', 1], ids.filter((i) => i !== 'thin')]]);
};

test('a thin landing offers a free reroll without consuming a skip', () => {
  const draft = new Draft(thinData(), {rng: firstChoiceRng, config: {manualSkipCount: 2}});
  assert.ok(draft.currentOffer!.thinRerollAvailable);
  const replacement = draft.useThinReroll();
  assert.deepEqual(replacement.cell, ['water', 1]);
  assert.ok(!replacement.thinRerollAvailable);
  assert.equal(draft.skipsRemaining, 2);
  assert.throws(() => draft.useThinReroll(), ThinRerollUnavailableError);
});

test('a thin reroll does not accumulate skip currency', () => {
  const draft = new Draft(thinData(), {rng: firstChoiceRng, config: {manualSkipCount: 0}});
  assert.ok(draft.currentOffer!.thinRerollAvailable);
  draft.useThinReroll();
  assert.equal(draft.skipsRemaining, 0);
  assert.throws(() => draft.useSkip(), NoSkipsRemainingError);
});

test('an overstuffed cell is capped to the configured candidate count', () => {
  const ids = ['eight', 'five', 'four', 'nine', 'one', 'seven', 'six', 'three', 'two'];
  const species = Object.fromEntries(ids.map((id) => [id, meta(id, ['water'])]));
  const draft = new Draft(dataOf(species, [[['water', 1], ids], [['fire', 1], ['one']]]), {rng: firstChoiceRng, config: {candidateCap: 5}});
  assert.equal(draft.currentOffer!.candidates.length, 5);
  assert.ok(draft.currentOffer!.candidates.every((c) => c in species));
});

test('small cells are not candidate-capped', () => {
  const ids = ['one', 'two', 'three', 'four', 'five'];
  const species = Object.fromEntries(ids.map((id) => [id, meta(id, ['water'])]));
  species.extra = meta('extra', ['fire']);
  const draft = new Draft(dataOf(species, [[['water', 1], ids], [['fire', 1], ['extra']]]), {rng: firstChoiceRng, config: {candidateCap: 5}});
  assert.deepEqual(draft.currentOffer!.candidates, [...ids].sort());
});

/** A water cell of commons plus one species of `rarity`; the fire cell keeps the draft alive. */
function oddsFixture(special: string, rarity: Rarity, commons = 5): LegalityData {
  const species: Record<string, SpeciesMetadata> = {[special]: meta(special, ['water'], {rarity})};
  for (let i = 0; i < commons; i++) species[`common${i}`] = meta(`common${i}`, ['water']);
  for (let i = 0; i < 4; i++) species[`extra${i}`] = meta(`extra${i}`, ['fire']);
  return dataOf(species, [[['water', 1], Object.keys(species).filter((id) => species[id].types[0] === 'water')], [['fire', 1], [0, 1, 2, 3].map((i) => `extra${i}`)]]);
}
function offeredShare(ld: LegalityData, special: string, config: Parameters<typeof draftConfig>[0], n = 4000): number {
  const rng = firstCellWeightedRng(12345);
  let hits = 0;
  for (let i = 0; i < n; i++) if (new Draft(ld, {rng, config}).currentOffer!.candidates.includes(special)) hits++;
  return hits / n;
}
const draftConfig = (c: {candidateCap?: number; rarityOdds?: [number, number, number, number]; backfillMin?: number; backfillMinNonLegendary?: number; backfillMinRare?: number}) => c;

test('a slot rolls its rarity from the configured odds', () => {
  // one slot, 10% legendary: the legendary is offered about one time in ten
  const share = offeredShare(oddsFixture('legend', LEGENDARY), 'legend', {candidateCap: 1, rarityOdds: [50, 28, 12, 10], backfillMin: 1, backfillMinNonLegendary: 0});
  assert.ok(Math.abs(share - 0.10) <= 0.02, `legendary offered ${share}`);
  // a rolled rarity the pool lacks falls down to the next one it has: here the
  // legendary roll becomes a rare (12% + 10%) and the uncommon roll a common
  const shareRare = offeredShare(oddsFixture('rare', RARE), 'rare', {candidateCap: 1, rarityOdds: [50, 28, 12, 10], backfillMin: 1, backfillMinNonLegendary: 0});
  assert.ok(Math.abs(shareRare - 0.22) <= 0.02, `rare offered ${shareRare}`);
});

test('an absent rarity falls down, never up: a cell of rares and legendaries keeps the legendary odds', () => {
  const species: Record<string, SpeciesMetadata> = {legend: meta('legend', ['water'], {rarity: LEGENDARY})};
  for (let i = 0; i < 5; i++) species[`rare${i}`] = meta(`rare${i}`, ['water'], {rarity: RARE});
  for (let i = 0; i < 4; i++) species[`extra${i}`] = meta(`extra${i}`, ['fire']);
  const ld = dataOf(species, [[['water', 1], ['legend', 'rare0', 'rare1', 'rare2', 'rare3', 'rare4']], [['fire', 1], [0, 1, 2, 3].map((i) => `extra${i}`)]]);
  const share = offeredShare(ld, 'legend', {candidateCap: 1, rarityOdds: [50, 28, 12, 10], backfillMin: 1, backfillMinNonLegendary: 0});
  assert.ok(Math.abs(share - 0.10) <= 0.02, `legendary offered ${share}`);
});

test('a short cell is filled with visitors from the nearest generations of its type', () => {
  const species: Record<string, SpeciesMetadata> = {native: meta('native', ['fire'], {gen: 4})};
  for (const g of [2, 3, 5, 6]) for (let i = 0; i < 3; i++) species[`g${g}n${i}`] = meta(`g${g}n${i}`, ['fire'], {gen: g});
  const matrix: [readonly [string, number], string[]][] = [[['fire', 4], ['native']]];
  for (const g of [2, 3, 5, 6]) matrix.push([['fire', g], [0, 1, 2].map((i) => `g${g}n${i}`)]);
  const draft = new Draft(dataOf(species, matrix), {rng: firstCellWeightedRng(3), config: {backfillMin: 6, backfillMinNonLegendary: 5}});
  const offer = draft.currentOffer!;
  assert.deepEqual(offer.cell, ['fire', 4]);
  assert.ok(offer.candidates.includes('native'), 'natives are always in the pool');
  assert.equal(offer.candidates.length, 5);
  assert.deepEqual(offer.visitors, offer.candidates.filter((id) => id !== 'native'));
  // distance 1 (gens 3 and 5) has six species, enough to reach the floor: no gen 2 or 6 visitors
  assert.ok(offer.visitors.every((id) => /^g[35]n/.test(id)), offer.visitors.join(','));
  assert.ok(offer.thinRerollAvailable, 'thin is judged on natives, not on the filled pool');
});

test('legendary-heavy cells pull non-legendary visitors so a legendary is never forced into the offer', () => {
  const species: Record<string, SpeciesMetadata> = {ordinary: meta('ordinary', ['dragon'], {gen: 4})};
  for (let i = 0; i < 5; i++) species[`legend${i}`] = meta(`legend${i}`, ['dragon'], {gen: 4, rarity: LEGENDARY});
  for (let i = 0; i < 6; i++) species[`g5n${i}`] = meta(`g5n${i}`, ['dragon'], {gen: 5});
  const ld = dataOf(species, [[['dragon', 4], ['ordinary', ...[0, 1, 2, 3, 4].map((i) => `legend${i}`)]], [['dragon', 5], [0, 1, 2, 3, 4, 5].map((i) => `g5n${i}`)]]);
  const rng = firstCellWeightedRng(8);
  let withLegend = 0;
  for (let i = 0; i < 500; i++) {
    const offer = new Draft(ld, {rng, config: {rarityOdds: [50, 28, 12, 10], backfillMin: 6, backfillMinNonLegendary: 5}}).currentOffer!;
    assert.equal(offer.candidates.length, 5);
    assert.ok(!offer.thinRerollAvailable);
    if (offer.candidates.some((id) => id.startsWith('legend'))) withLegend++;
  }
  // five slots at 10% each: roughly 41% of offers, far from the 100% a six-species cell would force
  assert.ok(withLegend / 500 > 0.3 && withLegend / 500 < 0.55, `${withLegend / 500}`);
});

test('a cell without a rare native borrows one rare visitor, never a legendary, so an Ultra Ball roll can land', () => {
  const species: Record<string, SpeciesMetadata> = {};
  for (let i = 0; i < 6; i++) species[`n${i}`] = meta(`n${i}`, ['bug'], {gen: 2});
  for (let i = 0; i < 3; i++) species[`g3c${i}`] = meta(`g3c${i}`, ['bug'], {gen: 3});
  species.g3legend = meta('g3legend', ['bug'], {gen: 3, rarity: LEGENDARY});
  species.g5rare = meta('g5rare', ['bug'], {gen: 5, rarity: RARE});
  const ld = dataOf(species, [
    [['bug', 2], [0, 1, 2, 3, 4, 5].map((i) => `n${i}`)],
    [['bug', 3], ['g3c0', 'g3c1', 'g3c2', 'g3legend']],
    [['bug', 5], ['g5rare']],
  ]);
  const rng = firstCellWeightedRng(6);
  let withRare = 0;
  for (let i = 0; i < 300; i++) {
    const offer = new Draft(ld, {rng, config: {rarityOdds: [40, 30, 20, 10], backfillMin: 6, backfillMinNonLegendary: 5, backfillMinRare: 1}}).currentOffer!;
    assert.equal(offer.candidates.length, 5);
    assert.ok(!offer.candidates.includes('g3legend'), 'the rare floor skips the nearer legendary');
    assert.ok(!offer.visitors.some((id) => id.startsWith('g3c')), 'the size floor was already met by natives');
    if (offer.candidates.includes('g5rare')) withRare++;
  }
  // rare 20% + legendary 10% falling down: 1 - 0.7^5 ≈ 83% of offers
  assert.ok(withRare / 300 > 0.7 && withRare / 300 < 0.95, `${withRare / 300}`);
  const without = new Draft(ld, {rng, config: {backfillMinRare: 0}}).currentOffer!;
  assert.ok(!without.candidates.includes('g5rare'), 'with the floor off the far rare stays home');
});

test('an offer exposes the candidate list, its visitors, and a soft suggestion', () => {
  const ld = legality();
  const offer = new Draft(ld, {rng: seededRng(5)}).currentOffer!;
  const natives = ld.matrix.get(offer.cell)!;
  assert.ok(offer.candidates.length >= 1 && offer.candidates.length <= 5);
  assert.ok(offer.candidates.includes(offer.suggestedSpecies));
  assert.deepEqual(offer.visitors, offer.candidates.filter((id) => !natives.includes(id)));
  for (const id of offer.visitors) {
    assert.equal(ld.species[id].debutGeneration === offer.cell[1], false);
    assert.ok(ld.species[id].types.includes(offer.cell[0]));
  }
});

test('with the real pool no cell forces a legendary into the offer', () => {
  const ld = legality();
  const rng = seededRng(2026);
  const guaranteed: string[] = [];
  for (const [cell] of ld.matrix.entries()) {
    const cellRng: DraftRng = {choice: (s) => (s.length && typeof s[0] === 'object' ? (s.find((c: any) => c[0] === cell[0] && c[1] === cell[1]) ?? s[0]) : rng.choice(s)), weightedChoice: rng.weightedChoice};
    let withLegend = 0;
    for (let i = 0; i < 60; i++) if (new Draft(ld, {rng: cellRng}).currentOffer!.candidates.some((id) => ld.species[id].legendary)) withLegend++;
    if (withLegend === 60) guaranteed.push(cell.join('/'));
  }
  assert.deepEqual(guaranteed, []);
});
