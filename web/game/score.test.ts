import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BAND_POINTS, campaignBand, costFactor, scoreRun, speedBonus, teamHandicap} from './score.ts';
import {loadGameData} from '../scripts/game-data.ts';

test('campaign bands follow the pool structure', () => {
  assert.deepEqual(Array.from({length: 10}, (_, i) => campaignBand(i)),
    ['level_1', 'level_2', 'level_3', 'middle', 'middle', 'middle', 'advanced', 'advanced', 'advanced', 'level_10']);
  assert.throws(() => campaignBand(10), RangeError);
  assert.equal(Object.values(BAND_POINTS).reduce((a, b) => a + b, 0), 1 + 2 + 3 + 5 + 8 + 15);
});

test('speed bonus is light and bounded', () => {
  assert.equal(speedBonus(0), 1.25);
  assert.equal(speedBonus(15), 1.125);
  assert.equal(speedBonus(30), 1);
  assert.equal(speedBonus(80), 1);
});

test('tier cost prefers the Showdown tier and falls back to base stats', () => {
  assert.equal(costFactor('Uber', 400), 0.5);
  assert.equal(costFactor('UUBL', 400), 0.8);
  assert.equal(costFactor('ZU', 700), 1.5);
  assert.equal(costFactor(undefined, 680), 0.5);
  assert.equal(costFactor(undefined, 500), 1.0);
  assert.equal(costFactor('NotATier', 300), 1.5);
});

test('checked-in tiers cover the draftable pool and rank teams as intended', () => {
  const data = loadGameData();
  assert.equal(data.tiers.nidoking, 'UU', 'species missing from gen9 keep their last tier');
  assert.equal(data.tiers.raticate, 'ZU');
  assert.equal(data.tiers.mewtwo, 'Uber');
  assert.equal(data.tiers.gholdengo, 'OU');
  const legends = ['mewtwo', 'lugia', 'groudon', 'kyogre', 'rayquaza', 'arceus'].map((id) => ({speciesId: id, tier: data.tiers[id], baseStatTotal: 680}));
  const scrubs = ['raticate', 'fearow', 'arbok', 'ledian', 'delcatty', 'spinda'].map((id) => ({speciesId: id, tier: data.tiers[id], baseStatTotal: 400}));
  assert.equal(teamHandicap(legends), 0.5);
  assert.equal(teamHandicap(scrubs), 1.5);
});

test('a run scores wins by band, with speed and handicap applied', () => {
  const team = Array(6).fill({speciesId: 'x', tier: 'UU', baseStatTotal: 500});
  const allWins = Array.from({length: 10}, () => ({winner: 'player' as const, turns: 30}));
  const perfect = scoreRun(allWins, team);
  assert.equal(perfect.base, 60);
  assert.equal(perfect.handicap, 1);
  assert.equal(perfect.total, 600);
  assert.equal(perfect.wins, 10);
  const fast = scoreRun(allWins.map((r) => ({...r, turns: 0})), team);
  assert.equal(fast.total, 750);
  const stopped = scoreRun([{winner: 'player', turns: 30}, {winner: 'player', turns: 30}, {winner: 'boss', turns: 12}], team);
  assert.equal(stopped.total, 30);
  assert.deepEqual(stopped.battles.map((b) => b.points), [1, 2, 0]);
  const legends = scoreRun(allWins, Array(6).fill({speciesId: 'x', tier: 'Uber', baseStatTotal: 680}));
  assert.equal(legends.total, 300, 'a six-legendary sweep scores half of a UU team');
});
