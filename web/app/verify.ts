// Server-side check of a leaderboard submission (docs/ROADMAP.md §7): re-run
// the whole campaign from its proof with the pure game layer and the
// simulator only, no search, and score the result ourselves. Anything that
// does not replay exactly is rejected. Used by api/leaderboard.ts and tests;
// never imported by the page (it pulls in @pkmn/sim).
import {Teams} from '@pkmn/sim';
import {ReplayMismatchError, replayBattle} from '../battle/runner.ts';
import {DraftError} from '../game/draft.ts';
import type {RunScore} from '../game/score.ts';
import {GameSession, PLAYER_NAME, SessionError, type GameContext, type RunProof} from './session.ts';

export class InvalidProofError extends Error {}

export interface VerifiedRun {
  score: RunScore;
  /** drafted species ids in pick order */
  team: string[];
  results: {bossName: string; winner: 'player' | 'boss' | 'tie'; turns: number}[];
  summary: string;
}

const MAX_ACTIONS = 60, MAX_BATTLES = 10, MAX_CHOICES = 600;
const ACTION = /^(pick:[a-z0-9]{1,40}|skip|reroll|set:[a-z0-9]{1,40}:[a-z0-9:_-]{1,60}|campaign:[01])$/;

function checkShape(p: unknown): RunProof {
  const proof = p as RunProof;
  if (!proof || typeof proof !== 'object' || proof.version !== 1) throw new InvalidProofError('unsupported proof version');
  if (!Number.isInteger(proof.seed) || proof.seed < 0 || proof.seed >= 2 ** 31) throw new InvalidProofError('bad seed');
  if (!Array.isArray(proof.actions) || proof.actions.length > MAX_ACTIONS || !proof.actions.every((a) => typeof a === 'string' && ACTION.test(a))) throw new InvalidProofError('bad actions');
  if (!Array.isArray(proof.battles) || proof.battles.length === 0 || proof.battles.length > MAX_BATTLES) throw new InvalidProofError('bad battles');
  for (const b of proof.battles) {
    if (!b || !Array.isArray(b.choices) || b.choices.length > MAX_CHOICES) throw new InvalidProofError('bad choices');
    for (const c of b.choices) {
      if (!c || (c.side !== 'p1' && c.side !== 'p2') || typeof c.choice !== 'string' || c.choice.length > 40) throw new InvalidProofError('bad choice');
    }
  }
  return proof;
}

export function verifyRun(ctx: GameContext, input: unknown): VerifiedRun {
  const proof = checkShape(input);
  const session = new GameSession(ctx, {seed: proof.seed});
  try {
    for (const action of proof.actions) {
      const [verb, a, b] = action.split(':');
      if (verb === 'pick') session.pick(a);
      else if (verb === 'skip') session.skip();
      else if (verb === 'reroll') session.thinReroll();
      else if (verb === 'set') session.chooseSet(a, action.slice(verb.length + a.length + 2));
      else if (verb === 'campaign') session.startCampaign(a === '1');
      void b;
    }
  } catch (err) {
    if (err instanceof DraftError || err instanceof SessionError) throw new InvalidProofError(`actions do not replay: ${err.message}`);
    throw err;
  }
  if (!session.isCampaign) throw new InvalidProofError('the proof never starts a campaign');

  let i = 0;
  for (;;) {
    let spec;
    try { spec = session.nextBattleSpec(); } catch (err) { throw new InvalidProofError((err as Error).message); }
    if (!spec) break;
    const battle = proof.battles[i++];
    if (!battle) throw new InvalidProofError(`the campaign needs battle ${i} but the proof has ${proof.battles.length}`);
    const p1 = Teams.import(spec.playerTeam), p2 = Teams.import(spec.bossTeam);
    if (!p1 || !p2) throw new InvalidProofError('team export did not parse');
    try {
      const outcome = replayBattle({p1: {name: PLAYER_NAME, team: p1}, p2: {name: spec.bossName, team: p2}, seed: spec.seed, choices: battle.choices});
      session.recordGauntletBattle(spec, outcome);
    } catch (err) {
      if (err instanceof ReplayMismatchError) throw new InvalidProofError(`battle ${i} does not replay: ${err.message}`);
      throw err;
    }
  }
  if (i !== proof.battles.length) throw new InvalidProofError(`the proof has ${proof.battles.length} battles but the campaign ended after ${i}`);
  const view = session.gauntletView();
  const score = session.score();
  if (!score || !view.complete) throw new InvalidProofError('the campaign did not complete');
  return {
    score,
    team: session.draft.picks.slice(),
    results: view.results.map((r) => ({bossName: r.bossName, winner: r.winner, turns: r.turns})),
    summary: view.summary ?? '',
  };
}
