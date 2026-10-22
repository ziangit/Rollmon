// Ported from tests/test_legality_matrix.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMON, FORME_DEBUT_GENERATION_OVERRIDES, LEGENDARY, MIN_CELL_SIZE, RARE, TIER_ONLY_SPECIES, UNCOMMON,
  buildLegalityData, buildMatrix, bstRank, cellsForSpecies, rarityOf, type SpeciesMetadata,
} from './legality-matrix.ts';
import {loadUsableSmogonSets} from './smogon-sets.ts';
import {loadGameData} from '../scripts/game-data.ts';

const data = loadGameData();
// Isolate from checked-in set overrides so these tests assert the pure
// configured-source pool regardless of which override files ship.
const legality = buildLegalityData({...data, overrides: {}});

const metadata = (id: string, types: string[], generation: number, opts: {legendary?: boolean; bst?: number} = {}): SpeciesMetadata =>
  ({speciesId: id, name: id, types, debutGeneration: generation, baseStatTotal: opts.bst ?? 500, rarity: opts.legendary ? LEGENDARY : COMMON, legendary: opts.legendary ?? false});

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

test('rarity is the Showdown tier rank, lifted to legendary above 600 base stats', () => {
  assert.equal(bstRank(601), LEGENDARY); assert.equal(bstRank(600), COMMON); assert.equal(bstRank(330), COMMON);
  assert.equal(rarityOf('x', 'Uber', 450), LEGENDARY); // banned tier, ordinary stats (Palafin)
  assert.equal(rarityOf('x', 'UUBL', 680), LEGENDARY); // 600+ stats, not Uber (Hoopa-Unbound)
  assert.equal(rarityOf('x', 'OU', 545), RARE); assert.equal(rarityOf('x', 'NU', 580), COMMON); // Articuno: stats alone do not lift
  assert.equal(rarityOf('x', 'RU', 545), UNCOMMON); assert.equal(rarityOf('x', 'ZU', 500), COMMON); // Carbink
  assert.equal(rarityOf('x', undefined, 720), LEGENDARY); assert.equal(rarityOf('x', undefined, 330), COMMON);
  // Truant / Slow Start: tier only, so the 670 stat-ball is not a prize
  assert.deepEqual(TIER_ONLY_SPECIES, new Set(['slaking', 'regigigas']));
  assert.equal(rarityOf('slaking', 'ZU', 670), COMMON);
  assert.equal(rarityOf('regigigas', 'ZU', 670), COMMON);
});

test('real species land in the expected rarity buckets', () => {
  const r = (id: string) => legality.species[id].rarity;
  assert.equal(r('slaking'), COMMON); assert.equal(r('regigigas'), COMMON); assert.equal(r('delibird'), COMMON);
  assert.equal(r('articuno'), COMMON); assert.equal(r('regirock'), COMMON); assert.equal(r('carbink'), COMMON);
  assert.equal(r('togekiss'), UNCOMMON); assert.equal(r('mew'), UNCOMMON); assert.equal(r('metagross'), UNCOMMON);
  assert.equal(r('garchomp'), RARE); assert.equal(r('dragonite'), RARE); assert.equal(r('tapukoko'), RARE);
  assert.equal(r('hoopaunbound'), LEGENDARY); assert.equal(r('zamazenta'), LEGENDARY); assert.equal(r('kyurem'), LEGENDARY);
  assert.equal(r('fluttermane'), LEGENDARY); assert.equal(r('palafin'), LEGENDARY); assert.equal(r('arceusfairy'), LEGENDARY);
  for (const m of Object.values(legality.species)) assert.equal(m.legendary, m.rarity === LEGENDARY);
  const counts = [0, 0, 0, 0];
  for (const m of Object.values(legality.species)) counts[m.rarity]++;
  assert.deepEqual(counts, [362, 131, 69, 77]);
});

test('without tier data rarity falls back to base stats', () => {
  const untiered = buildLegalityData({...data, overrides: {}, tiers: undefined});
  assert.equal(untiered.species.palafin.rarity, COMMON);
  assert.equal(untiered.species.hoopaunbound.rarity, LEGENDARY);
  assert.equal(untiered.species.slaking.rarity, COMMON);
});

test('megas, gigantamax, and battle formes do not leak', () => {
  for (const id of ['charizardmegax', 'charizardmegay', 'charizardgmax', 'pikachugmax', 'necrozmaultra']) assert.ok(!legality.atoms.includes(id));
  for (const id of legality.atoms) {
    const forme = String(data.pokedex[id].forme ?? '').toLowerCase();
    assert.ok(!forme.startsWith('mega') && !forme.startsWith('gmax'));
  }
});
