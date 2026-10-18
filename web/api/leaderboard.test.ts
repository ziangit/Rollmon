// The API against an in-memory store: a real (engine-less) campaign proof is
// accepted and ranked; bad input is rejected with the right status.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Teams} from '@pkmn/sim';
import {DuplicateRunError, cleanName, createLeaderboardApi, type Entry, type NewEntry, type Store} from './leaderboard.ts';
import {runBattle, type Engine} from '../battle/runner.ts';
import {GameSession, PLAYER_NAME, createGameContext, type RunProof} from '../app/session.ts';
import {loadGameData} from '../scripts/game-data.ts';

const ctx = createGameContext(loadGameData());
const noEngine: Engine = {mcts: () => { throw new Error('no engine'); }, engine_version: () => 'none'};

function memoryStore(): Store & {rows: (Entry & NewEntry)[]} {
  const rows: (Entry & NewEntry)[] = [];
  const ranked = () => [...rows].sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
  return {
    rows,
    async top(limit) { return ranked().slice(0, limit).map(({id, name, score, wins, battles, team, handicap, createdAt}) => ({id, name, score, wins, battles, team, handicap, createdAt})); },
    async insert(e) {
      if (e.token && rows.some((r) => r.seed === e.seed && r.token === e.token)) throw new DuplicateRunError('dup');
      const row = {...e, id: rows.length + 1, createdAt: new Date(Date.now() + rows.length).toISOString()};
      rows.push(row);
      return {id: row.id, rank: ranked().indexOf(row) + 1};
    },
  };
}

function proofFor(seed: number): RunProof {
  const s = new GameSession(ctx, {seed});
  while (!s.draft.complete) s.pick(s.draft.currentOffer!.suggestedSpecies);
  s.startCampaign(true);
  for (;;) {
    const spec = s.nextBattleSpec();
    if (!spec) break;
    s.recordGauntletBattle(spec, runBattle({engine: noEngine, p1: {name: PLAYER_NAME, team: Teams.import(spec.playerTeam)!}, p2: {name: spec.bossName, team: Teams.import(spec.bossTeam)!}, seed: spec.seed, budgetMs: {p1: 1, p2: 1}}));
  }
  return s.runProof()!;
}

const req = (method: string, body?: unknown, query = '') => ({method, path: '/api/leaderboard', query: new URLSearchParams(query), body: body === undefined ? null : JSON.stringify(body)});

test('names are trimmed, bounded, and stripped of control characters', () => {
  assert.equal(cleanName('  Ash   Ketchum\u0007 '), 'Ash Ketchum');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('x'.repeat(25)), null);
  assert.equal(cleanName(42), null);
});

test('without a store the API reports itself unconfigured', async () => {
  const api = createLeaderboardApi({ctx, store: async () => null});
  assert.deepEqual(await api(req('GET', undefined, 'health')), {status: 200, body: {ok: true, configured: false}});
  assert.equal((await api(req('GET'))).status, 503);
  assert.equal((await api(req('POST', {name: 'x', proof: {}}))).status, 503);
});

test('a verified run is stored and ranked; bad submissions get 4xx', async () => {
  const store = memoryStore();
  const api = createLeaderboardApi({ctx, store: async () => store});
  const proof = proofFor(21);
  const first = await api(req('POST', {name: 'Red', proof, token: 'tok_000000001'}));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const body = first.body as {rank: number; score: number; wins: number};
  assert.equal(body.rank, 1);
  assert.equal(store.rows[0].score, body.score);
  assert.equal(store.rows[0].team.length, 6);

  assert.equal((await api(req('POST', {name: 'Red', proof, token: 'tok_000000001'}))).status, 409, 'same run, same client');
  assert.equal((await api(req('POST', {name: '', proof}))).status, 400);
  assert.equal((await api(req('POST', {name: 'Blue', proof: {...proof, seed: proof.seed + 1}}))).status, 422);
  assert.equal((await api(req('POST', {name: 'Blue', proof: null}))).status, 422);
  assert.equal((await api({...req('POST'), body: '{not json'})).status, 400);
  assert.equal((await api({...req('POST'), body: 'x'.repeat(600 * 1024)})).status, 413);
  assert.equal((await api(req('DELETE'))).status, 405);
  assert.equal((await api({...req('GET'), path: '/api/other'})).status, 404);

  const second = await api(req('POST', {name: 'Blue', proof: proofFor(5), token: 'tok_000000002'}));
  assert.equal(second.status, 201);
  const list = (await api(req('GET', undefined, 'limit=10'))).body as {entries: Entry[]};
  assert.equal(list.entries.length, 2);
  assert.ok(list.entries[0].score >= list.entries[1].score);
  assert.ok(!('proof' in list.entries[0]), 'listings never include the proof');
});
