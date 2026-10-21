// Ported from tests/test_legality_matrix.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  CellMap, FORME_DEBUT_GENERATION_OVERRIDES, LEGENDARY_BST_EXCLUSIONS, LEGENDARY_BST_THRESHOLD, MIN_CELL_SIZE,
  buildLegalityData, buildMatrix, cellsForSpecies, selectSpecies, selectionProbabilities, type Cell, type SpeciesMetadata,
} from './legality-matrix.ts';
import {loadUsableSmogonSets} from './smogon-sets.ts';
import {seededRng} from './rng.ts';
import {loadGameData} from '../scripts/game-data.ts';

const data = loadGameData();
// Isolate from checked-in set overrides so these tests assert the pure
// configured-source pool regardless of which override files ship.
const legality = buildLegalityData({...data, overrides: {}});

const metadata = (id: string, types: string[], generation: number, opts: {legendary?: boolean; bst?: number} = {}): SpeciesMetadata =>
  ({speciesId: id, name: id, types, debutGeneration: generation, baseStatTotal: opts.bst ?? 500, legendary: opts.legendary ?? false});
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test('atom count matches the usable Smogon source', () => {
  const source = loadUsableSmogonSets(data.smogon, data);
  assert.equal(Object.keys(source).length, 639);
  assert.equal(legality.atoms.length, 639);
  assert.deepEqual(new Set(legality.atoms), new Set(Object.keys(source)));
});

test('randbats source remains available', () => {
  const randbats = buildLegalityData({...data, overrides: {}, source: 'randbats'});
  assert.equal(Object.keys(data.randbats).length, 508);
  assert.deepEqual(new Set(randbats.atoms), new Set(Object.keys(data.randbats)));
});

test('set overrides contribute draftable atoms; non-species files are ignored', () => {
  const overrides = {absol: 'Absol @ Absolite\nAbility: Pressure\n- Knock Off\n', notes: 'not a species'};
  const augmented = buildLegalityData({...data, overrides});
  assert.ok(!legality.atoms.includes('absol'));
  assert.ok(augmented.atoms.includes('absol'));
  assert.ok(!augmented.atoms.includes('notes'));
  // Drafted with its base typing/generation (Mega is a battle-only forme).
  assert.deepEqual(augmented.species.absol.types, ['dark']);
  assert.equal(augmented.species.absol.debutGeneration, 3);
});

test('matrix includes nonempty cells and excludes only empty cells', () => {
  const species: Record<string, SpeciesMetadata> = {};
  for (let i = 0; i < 3; i++) species[`small${i}`] = metadata(`small${i}`, ['fire'], 1);
  for (let i = 0; i < MIN_CELL_SIZE; i++) species[`valid${i}`] = metadata(`valid${i}`, ['water'], 1);
  const matrix = buildMatrix(species);
  assert.equal(matrix.get(['fire', 1])!.length, 3);
  assert.equal(matrix.get(['water', 1])!.length, MIN_CELL_SIZE);
  assert.ok(!matrix.has(['grass', 1]));
});

test('modern type and debut generation placements', () => {
  const clefable = legality.species.clefable;
  assert.deepEqual(clefable.types, ['fairy']);
  assert.equal(clefable.debutGeneration, 1);
  assert.deepEqual(cellsForSpecies(clefable), [['fairy', 1]]);
  assert.ok(legality.matrix.get(['fairy', 1])!.includes('clefable'));

  const charizard = legality.species.charizard;
  assert.deepEqual(charizard.types, ['fire', 'flying']);
  assert.deepEqual(cellsForSpecies(charizard), [['fire', 1], ['flying', 1]]);
  assert.ok(legality.matrix.get(['flying', 1])!.includes('charizard'));

  const raichu = legality.species.raichualola;
  assert.deepEqual(raichu.types, ['electric', 'psychic']);
  assert.equal(raichu.debutGeneration, 7);
  assert.equal(FORME_DEBUT_GENERATION_OVERRIDES.raichualola, 7);
  assert.ok(legality.matrix.get(['psychic', 7])!.includes('raichualola'));
});

test('legendary is strictly BST above 600, with the two ability exclusions', () => {
  assert.equal(LEGENDARY_BST_THRESHOLD, 600);
  assert.deepEqual(LEGENDARY_BST_EXCLUSIONS, new Set(['slaking', 'regigigas']));
  assert.equal(legality.species.slaking.baseStatTotal, 670);
  assert.ok(!legality.species.slaking.legendary);
  assert.equal(legality.species.regigigas.baseStatTotal, 670);
  assert.ok(!legality.species.regigigas.legendary);
  assert.equal(legality.species.arceusfairy.baseStatTotal, 720);
  assert.ok(legality.species.arceusfairy.legendary);
  assert.equal(legality.species.dragonite.baseStatTotal, 600);
  assert.ok(!legality.species.dragonite.legendary);
  assert.ok(!legality.species.mew.legendary);
  assert.equal(legality.species.articuno.baseStatTotal, 580);
  for (const m of Object.values(legality.species)) {
    assert.equal(m.legendary, m.baseStatTotal > 600 && !LEGENDARY_BST_EXCLUSIONS.has(m.speciesId));
  }
});

test('selector probabilities use the same positive legendary weight', () => {
  const cell: Cell = ['normal', 3];
  const species = {ordinary: metadata('ordinary', ['normal'], 3), slaking: metadata('slaking', ['normal'], 3, {bst: 670, legendary: true})};
  const p = selectionProbabilities(cell, new CellMap([[cell, Object.keys(species)]]), species, {legendaryWeight: 0.25});
  assert.ok(approx(p.get('ordinary')!, 0.8));
  assert.ok(approx(p.get('slaking')!, 0.2));
});

test('arceus probability uses the arceus-specific weight', () => {
  const cell: Cell = ['fire', 4];
  const species = {
    ordinary: metadata('ordinary', ['fire'], 4), legend: metadata('legend', ['fire'], 4, {legendary: true}),
    arceusfire: metadata('arceusfire', ['fire'], 4, {legendary: true}),
  };
  const p = selectionProbabilities(cell, new CellMap([[cell, Object.keys(species)]]), species, {legendaryWeight: 0.10, arceusWeight: 0.05});
  assert.ok(approx(p.get('ordinary')!, 1 / 1.15));
  assert.ok(approx(p.get('legend')!, 0.10 / 1.15));
  assert.ok(approx(p.get('arceusfire')!, 0.05 / 1.15));
});

test('legendary selection is down-weighted deterministically', () => {
  const cell: Cell = ['psychic', 1];
  const species = {normal: metadata('normal', ['psychic'], 1), legend: metadata('legend', ['psychic'], 1, {legendary: true})};
  const matrix = new CellMap([[cell, ['normal', 'legend']]]);
  const rng = seededRng(24601);
  const picks = Array.from({length: 2000}, () => selectSpecies(cell, matrix, species, {rng, legendaryWeight: 0.25}));
  const legends = picks.filter((p) => p === 'legend').length;
  assert.ok(legends > 0 && legends < picks.length - legends);
});

test('a three-of-four legendary cell never soft-locks', () => {
  const cell: Cell = ['dragon', 9];
  const species: Record<string, SpeciesMetadata> = {ordinary: metadata('ordinary', ['dragon'], 9)};
  for (let i = 0; i < 3; i++) species[`legend${i}`] = metadata(`legend${i}`, ['dragon'], 9, {legendary: true});
  const matrix = new CellMap([[cell, Object.keys(species)]]);
  const rng = seededRng(7);
  const picks = Array.from({length: 1000}, () => selectSpecies(cell, matrix, species, {rng, legendaryWeight: 0.01}));
  assert.ok(picks.every((p) => p in species));
  assert.ok(picks.some((p) => p.startsWith('legend')));
});

test('every included real cell can return a pick', () => {
  const rng = seededRng(99);
  for (const [cell, eligible] of legality.matrix.entries()) {
    assert.ok(eligible.length >= 1);
    assert.ok(eligible.includes(selectSpecies(cell, legality.matrix, legality.species, {rng})));
  }
});

test('megas, gigantamax, and battle formes do not leak', () => {
  for (const id of ['charizardmegax', 'charizardmegay', 'charizardgmax', 'pikachugmax', 'necrozmaultra']) assert.ok(!legality.atoms.includes(id));
  for (const id of legality.atoms) {
    const forme = String(data.pokedex[id].forme ?? '').toLowerCase();
    assert.ok(!forme.startsWith('mega') && !forme.startsWith('gmax'));
  }
});
