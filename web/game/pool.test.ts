// Ported from tests/test_pool_loader.py, test_boss_loader.py, test_submissions.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CAMPAIGN_STRUCTURE, PoolError, buildCampaign, loadPoolTeam, tierTeams, type Pool} from './pool.ts';
import {BossTeamError, bossDisplayName, listBossIds, loadBossTeam} from './bosses.ts';
import {SubmissionError, parseShowdownExport, validateSubmission, verifyTeamEntitiesExist} from './submissions.ts';
import {seededRng} from './rng.ts';
import {loadGameData} from '../scripts/game-data.ts';

const data = loadGameData();
const pool = (layout: Record<string, string[]>): Pool =>
  Object.fromEntries(Object.entries(layout).map(([tier, teams]) => [tier, Object.fromEntries(teams.map((t) => [t, `${t} placeholder\n`]))]));

test('the campaign structure sums to ten battles', () => {
  assert.equal(CAMPAIGN_STRUCTURE.reduce((n, [, c]) => n + c, 0), 10);
});

test('tier teams are sorted stems', () => {
  const p = pool({level_1: ['LC3', 'LC', 'LC2']});
  assert.deepEqual(tierTeams('level_1', p), ['LC', 'LC2', 'LC3']);
  assert.deepEqual(tierTeams('missing', p), []);
});

test('a campaign is ten ordered battles in tier order', () => {
  const p = pool({level_1: ['a'], level_2: ['b'], level_3: ['c'], middle: ['d', 'e', 'f'], advanced: ['g', 'h', 'i'], level_10: ['j']});
  const campaign = buildCampaign(p, {rng: seededRng(1)});
  assert.deepEqual(campaign.map((b) => b.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(campaign.map((b) => b.tier), ['level_1', 'level_2', 'level_3', 'middle', 'middle', 'middle', 'advanced', 'advanced', 'advanced', 'level_10']);
  assert.deepEqual(campaign.filter((b) => b.tier === 'middle').map((b) => b.teamId).sort(), ['d', 'e', 'f']);
  assert.deepEqual(campaign.filter((b) => b.tier === 'advanced').map((b) => b.teamId).sort(), ['g', 'h', 'i']);
  assert.ok(campaign[0].export.startsWith('a'));
});

test('a campaign is deterministic under a seed', () => {
  const p = pool({level_1: ['a1', 'a2', 'a3'], level_2: ['b'], level_3: ['c'], middle: ['d', 'e', 'f'], advanced: ['g', 'h', 'i', 'j', 'k'], level_10: ['l']});
  const first = buildCampaign(p, {rng: seededRng(7)});
  const second = buildCampaign(p, {rng: seededRng(7)});
  assert.deepEqual(first.map((b) => b.teamId), second.map((b) => b.teamId));
  assert.equal(new Set(first.filter((b) => b.tier === 'advanced').map((b) => b.teamId)).size, 3);
});

test('a too-thin tier is an error', () => {
  const p = pool({level_1: ['a'], level_2: ['b'], level_3: ['c'], middle: ['d', 'e', 'f'], advanced: ['g', 'h'], level_10: ['j']});
  assert.throws(() => buildCampaign(p, {rng: seededRng(0)}), PoolError);
});

test('the checked-in pool builds a valid campaign', () => {
  const campaign = buildCampaign(data.pool, {rng: seededRng(2026)});
  assert.equal(campaign.length, 10);
  for (const battle of campaign) {
    verifyTeamEntitiesExist({team: battle.export}, data);
    assert.equal(battle.export, loadPoolTeam(battle.tier, battle.teamId, data.pool));
  }
});

test('the Ash team is a six-member level 100 export', () => {
  const team = loadBossTeam('ash', data.bosses);
  assert.equal(team.split('\n\n').length, 6);
  assert.equal(team.split('Level: 100').length - 1, 6);
  assert.ok(team.includes('Pikachu @ Light Ball') && team.includes('- Volt Tackle') && team.includes('- Hydro Cannon'));
  assert.equal(bossDisplayName('ash', data.bosses), 'Ash');
  assert.ok(listBossIds(data.bosses).includes('ash'));
});

test('unknown and invalid bosses are rejected', () => {
  assert.throws(() => loadBossTeam('missing', data.bosses), /unknown boss/);
  assert.throws(() => loadBossTeam('../ash', data.bosses), BossTeamError);
});

test('a contributed boss file is discovered and usable', () => {
  const bosses = {misty: loadBossTeam('ash', data.bosses)};
  assert.equal(parseShowdownExport(loadBossTeam('misty.txt', bosses), {expectedMembers: 6}).length, 6);
  assert.deepEqual(listBossIds(bosses), ['misty']);
  assert.equal(bossDisplayName('team_rocket-grunt', {'team_rocket-grunt': 'x'}), 'Team Rocket Grunt');
});

test('ash is the first boss when present', () => {
  assert.deepEqual(listBossIds({cynthia: 'x', ash: 'x', alder: 'x'}), ['ash', 'alder', 'cynthia']);
});

test('standard team and single set use the export parser', () => {
  const boss = loadBossTeam('ash', data.bosses);
  const set = boss.split('\n\n')[0];
  assert.deepEqual(validateSubmission(boss, 'boss', data), [6, 24]);
  assert.deepEqual(validateSubmission(set, 'set', data), [1, 4]);
  assert.equal(parseShowdownExport(set, {expectedMembers: 1})[0].species, 'pikachu');
});

test('a malformed submission has a clear error', () => {
  assert.throws(() => validateSubmission('Pikachu @ Light Ball\nAbility: Static\n', 'set', data), (e: Error) => e instanceof SubmissionError && /member 1 has no moves/.test(e.message));
  assert.throws(() => validateSubmission('Pikachu @ Light Ball\nLevel: x\n- Thunderbolt', 'set', data), /malformed/);
});
