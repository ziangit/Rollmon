import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BAND_POINTS, campaignBand, costFactor, scoreRun, speedBonus, teamHandicap} from './score.ts';
import {loadGameData} from '../scripts/game-data.ts';

test('campaign bands follow the pool structure', () => {
  assert.deepEqual(Array.from({length: 10}, (_, i) => campaignBand(i)),
    ['level_1', 'level_2', 'level_3', 'middle', 'middle', 'middle', 'advanced', 'advanced', 'advanced', 'level_10']);
  assert.throws(() => campaignBand(10), RangeError);
  assert.equal(Object.values(BAND_POINTS).reduce((a, b) => a + b, 0), 1 + 2 + 3 + 5 + 8 + 30);
});

test('speed bonus is a token and bounded', () => {
  assert.equal(speedBonus(0), 1.05);
  assert.equal(speedBonus(15), 1.025);
  assert.equal(speedBonus(30), 1);
  assert.equal(speedBonus(80), 1);
});

test('tier cost prefers the Showdown tier and falls back to base stats', () => {
  assert.equal(costFactor('Uber', 400), 0.8);
  assert.equal(costFactor('UUBL', 400), 0.88);
  assert.equal(costFactor('ZU', 700), 1.2);
  assert.equal(costFactor(undefined, 680), 0.8);
  assert.equal(costFactor(undefined, 500), 0.96);
  assert.equal(costFactor('NotATier', 300), 1.2);
});

test('checked-in tiers cover the draftable pool and rank teams as intended', () => {
  const data = loadGameData();
  assert.equal(data.tiers.nidoking, 'UU', 'species missing from gen9 keep their last tier');
  assert.equal(data.tiers.raticate, 'ZU');
  assert.equal(data.tiers.mewtwo, 'Uber');
  assert.equal(data.tiers.gholdengo, 'OU');
  const legends = ['mewtwo', 'lugia', 'groudon', 'kyogre', 'rayquaza', 'arceus'].map((id) => ({speciesId: id, tier: data.tiers[id], baseStatTotal: 680}));
  const scrubs = ['raticate', 'fearow', 'arbok', 'ledian', 'delcatty', 'spinda'].map((id) => ({speciesId: id, tier: data.tiers[id], baseStatTotal: 400}));
  assert.equal(teamHandicap(legends), 0.8);
  assert.equal(teamHandicap(scrubs), 1.2);
  assert.equal(data.tiers.charizardmegax, 'OU', 'Mega formes are tiered, so a Mega set can score as its forme');
});

test('a run scores wins by band, with speed and handicap applied', () => {
  const team = Array(6).fill({speciesId: 'x', tier: 'UU', baseStatTotal: 500});
  const allWins = Array.from({length: 10}, () => ({winner: 'player' as const, turns: 30}));
  const perfect = scoreRun(allWins, team);
  assert.equal(perfect.base, 75);
  assert.equal(perfect.handicap, 0.96);
  assert.equal(perfect.total, 720);
  assert.equal(perfect.wins, 10);
  assert.equal(perfect.turns, 300);
  const fast = scoreRun(allWins.map((r) => ({...r, turns: 0})), team);
  assert.equal(fast.total, 756, 'the speed bonus is worth 5% at most');
  const stopped = scoreRun([{winner: 'player', turns: 30}, {winner: 'player', turns: 30}, {winner: 'boss', turns: 12}], team);
  assert.equal(stopped.total, 29);
  assert.deepEqual(stopped.battles.map((b) => b.points), [1, 2, 0]);
  assert.equal(stopped.turns, 72);
});

test('the handicap is worth about one level, and any clear beats any level-9 run', () => {
  const ubers = Array(6).fill({speciesId: 'x', tier: 'Uber', baseStatTotal: 680});
  const scrubs = Array(6).fill({speciesId: 'x', tier: 'ZU', baseStatTotal: 400});
  const wins = (n: number, turns = 30) => [...Array.from({length: n}, () => ({winner: 'player' as const, turns})), ...(n < 10 ? [{winner: 'boss' as const, turns}] : [])];
  assert.ok(scoreRun(wins(5), scrubs).total > scoreRun(wins(6), ubers).total, 'six ZU at level 5 beat six Ubers at level 6');
  assert.ok(scoreRun(wins(5), scrubs).total < scoreRun(wins(7), ubers).total, 'but not six Ubers at level 7');
  assert.ok(scoreRun(wins(10), ubers).total > scoreRun(wins(9, 0), scrubs).total, 'the slowest Uber clear beats the fastest ZU level-9 run');
  assert.equal(scoreRun(wins(10), ubers).total, 600);
  assert.equal(scoreRun(wins(9, 0), scrubs).total, 567);
});
