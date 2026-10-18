// Ported from tests/test_draft.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Draft, DraftCompleteError, NoSkipsRemainingError, TEAM_SIZE, ThinRerollUnavailableError, type DraftRng} from './draft.ts';
import {CellMap, buildLegalityData, type LegalityData, type SpeciesMetadata} from './legality-matrix.ts';
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
const meta = (id: string, types: string[]): SpeciesMetadata => ({speciesId: id, name: id, types, debutGeneration: 1, baseStatTotal: 500, legendary: false});
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
  assert.deepEqual(draft.currentOffer!.candidates, ids);
});

function cappedRatio(secondId: string, config: {legendaryWeight?: number; arceusWeight?: number}): number {
  const species: Record<string, SpeciesMetadata> = {normal: meta('normal', ['water']), [secondId]: {...meta(secondId, ['water']), baseStatTotal: 700, legendary: true}};
  for (let i = 0; i < 4; i++) species[`extra${i}`] = meta(`extra${i}`, ['fire']);
  const ld = dataOf(species, [[['water', 1], ['normal', secondId]], [['fire', 1], [0, 1, 2, 3].map((i) => `extra${i}`)]]);
  const rng = firstCellWeightedRng(12345);
  const picks = Array.from({length: 5000}, () => new Draft(ld, {rng, config: {candidateCap: 1, ...config}}).currentOffer!.candidates[0]);
  return picks.filter((p) => p === secondId).length / picks.filter((p) => p === 'normal').length;
}

test('the offer cap samples candidates with the legendary weight', () => {
  assert.ok(Math.abs(cappedRatio('legend', {legendaryWeight: 0.10}) - 0.10) <= 0.025);
});

test('the offer cap samples candidates with the arceus weight', () => {
  assert.ok(Math.abs(cappedRatio('arceuswater', {arceusWeight: 0.05}) - 0.05) <= 0.02);
});

test('an offer exposes the capped candidate list and a soft suggestion', () => {
  const ld = legality();
  const offer = new Draft(ld, {rng: seededRng(5)}).currentOffer!;
  assert.ok(offer.candidates.every((c) => ld.matrix.get(offer.cell)!.includes(c)));
  assert.ok(offer.candidates.length >= 1 && offer.candidates.length <= 5);
  assert.ok(offer.candidates.includes(offer.suggestedSpecies));
  assert.deepEqual(new Set(offer.selectionProbabilities.keys()), new Set(offer.candidates));
  assert.ok(Math.abs([...offer.selectionProbabilities.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
