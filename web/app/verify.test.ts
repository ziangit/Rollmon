// A real (engine-less) campaign is recorded as a proof and must verify to the
// same score; tampering with any part of it is rejected.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Teams} from '@pkmn/sim';
import {runBattle, type Engine} from '../battle/runner.ts';
import {GameSession, PLAYER_NAME, createGameContext, type RunProof} from './session.ts';
import {InvalidProofError, verifyRun} from './verify.ts';
import {loadGameData} from '../scripts/game-data.ts';

const ctx = createGameContext(loadGameData());
const noEngine: Engine = {mcts: () => { throw new Error('no engine'); }, engine_version: () => 'none'};

function playCampaign(seed: number, stopOnLoss: boolean): {session: GameSession; proof: RunProof} {
  const s = new GameSession(ctx, {seed});
  s.skip();
  while (!s.draft.complete) s.pick(s.draft.currentOffer!.suggestedSpecies);
  const entry = s.view().loadout!.find((e) => e.sets.length > 1)!;
  s.chooseSet(entry.speciesId, entry.sets.find((o) => o.setId !== entry.chosenSetId)!.setId);
  s.startCampaign(stopOnLoss);
  for (;;) {
    const spec = s.nextBattleSpec();
    if (!spec) break;
    const o = runBattle({engine: noEngine, p1: {name: PLAYER_NAME, team: Teams.import(spec.playerTeam)!}, p2: {name: spec.bossName, team: Teams.import(spec.bossTeam)!}, seed: spec.seed, budgetMs: {p1: 1, p2: 1}});
    s.recordGauntletBattle(spec, o);
  }
  const proof = s.runProof();
  assert.ok(proof, 'a complete campaign yields a proof');
  return {session: s, proof: proof!};
}

test('a recorded campaign verifies to the same score and results', () => {
  const {session, proof} = playCampaign(21, false);
  assert.equal(proof.battles.length, 10);
  assert.ok(proof.actions[0] === 'skip' && proof.actions.at(-1) === 'campaign:0' && proof.actions.some((a) => a.startsWith('set:')));
  const v = verifyRun(ctx, JSON.parse(JSON.stringify(proof)));
  const g = session.gauntletView();
  assert.equal(v.score.total, g.score!.total);
  assert.deepEqual(v.results, g.results.map((r) => ({bossName: r.bossName, winner: r.winner, turns: r.turns})));
  assert.deepEqual(v.team, session.draft.picks);
  assert.equal(v.summary, g.summary);
});

test('stop-on-loss campaigns verify with fewer battles', () => {
  const {session, proof} = playCampaign(5, true);
  const v = verifyRun(ctx, proof);
  assert.equal(v.results.length, session.gauntletView().results.length);
  assert.equal(v.score.total, session.gauntletView().score!.total);
});

test('tampered proofs are rejected', () => {
  const {proof} = playCampaign(21, false);
  const clone = () => JSON.parse(JSON.stringify(proof)) as RunProof;
  let p = clone(); p.seed += 1;
  assert.throws(() => verifyRun(ctx, p), InvalidProofError, 'another seed');
  p = clone(); p.battles[3].choices[4].choice = 'move 1';
  assert.throws(() => verifyRun(ctx, p), InvalidProofError, 'a changed choice (either illegal or diverging)');
  p = clone(); p.battles.pop();
  assert.throws(() => verifyRun(ctx, p), InvalidProofError, 'a missing battle');
  p = clone(); p.actions = p.actions.filter((a) => !a.startsWith('set:'));
  assert.throws(() => verifyRun(ctx, p), InvalidProofError, 'a different loadout changes the team and the battles diverge');
  p = clone(); p.actions[1] = 'pick:mewtwo';
  assert.throws(() => verifyRun(ctx, p), InvalidProofError, 'a pick that was not offered');
  assert.throws(() => verifyRun(ctx, {...clone(), version: 2}), InvalidProofError);
  assert.throws(() => verifyRun(ctx, {...clone(), actions: ['rm -rf']}), InvalidProofError);
  assert.throws(() => verifyRun(ctx, null), InvalidProofError);
});

test('manual ladders and exhibition battles are not scored and have no proof', () => {
  const s = new GameSession(ctx, {seed: 9});
  while (!s.draft.complete) s.pick(s.draft.currentOffer!.suggestedSpecies);
  s.startGauntlet(['ash'], true);
  const spec = s.nextBattleSpec()!;
  s.recordGauntletBattle(spec, {winner: PLAYER_NAME, turns: 5, log: ['|win|Player'], choices: [{side: 'p1', choice: 'move 1'}]});
  const g = s.gauntletView();
  assert.ok(g.complete && !g.campaign && g.score === null);
  assert.equal(s.runProof(), null);
});
