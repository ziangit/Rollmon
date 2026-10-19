// The API against an in-memory store: accounts register and log in, a real
// (engine-less) campaign proof posted by a signed-in player is accepted and
// ranked by personal best; bad input is rejected with the right status.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Teams} from '@pkmn/sim';
import {createApi, type ApiRequest, type ApiResponse, type Entry} from './leaderboard.ts';
import {memoryStore} from './memory.ts';
import {runBattle, type Engine} from '../battle/runner.ts';
import {GameSession, PLAYER_NAME, createGameContext, type RunProof} from '../app/session.ts';
import {loadGameData} from '../scripts/game-data.ts';

const ctx = createGameContext(loadGameData());
const noEngine: Engine = {mcts: () => { throw new Error('no engine'); }, engine_version: () => 'none'};

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

type Extra = Partial<Omit<ApiRequest, 'query'>> & {query?: string};
const req = (method: string, body?: unknown, extra: Extra = {}): ApiRequest =>
  ({method, path: '/api/leaderboard', body: body === undefined ? null : JSON.stringify(body), ip: '203.0.113.9', ...extra, query: new URLSearchParams(extra.query ?? '')});
const authReq = (op: string, body?: unknown, extra: Extra = {}) => req(body === undefined ? 'GET' : 'POST', body, {path: `/api/auth/${op}`, ...extra});
const cookieOf = (res: ApiResponse) => res.setCookie!.split(';')[0];

test('without a store or secret the API reports itself unconfigured', async () => {
  const api = createApi({ctx, store: async () => null});
  assert.deepEqual(await api(req('GET', undefined, {query: 'health'})), {status: 200, body: {ok: true, configured: false, accounts: false}});
  assert.equal((await api(req('GET'))).status, 503);
  assert.equal((await api(authReq('register', {name: 'x', password: 'password1'}))).status, 503);
  assert.deepEqual((await api(authReq('me'))).body, {user: null, accounts: false});
});

test('accounts: register, log in, log out, name rules, sign-up limit per network', async () => {
  let clock = 1_700_000_000_000;
  const store = memoryStore(() => clock);
  const api = createApi({ctx, store: async () => store, secret: 'test-secret', now: () => clock});

  const reg = await api(authReq('register', {name: ' R.e.d ', password: 'hunter22x'}));
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.deepEqual(reg.body, {user: {name: 'R.e.d'}});
  const cookie = cookieOf(reg);
  assert.deepEqual((await api(authReq('me', undefined, {cookie}))).body, {user: {id: 1, name: 'R.e.d'}, accounts: true});

  assert.equal((await api(authReq('register', {name: 'RED', password: 'hunter22x'}))).status, 409, 'same identity');
  assert.equal((await api(authReq('register', {name: '!!!', password: 'hunter22x'}))).status, 400);
  assert.equal((await api(authReq('register', {name: 'Blue', password: 'short'}))).status, 400);
  assert.equal((await api(authReq('register', {name: 'admin', password: 'hunter22x'}))).status, 400, 'reserved');
  assert.equal((await api({...authReq('register'), method: 'POST', body: '{nope'})).status, 400);
  assert.equal((await api(authReq('login', {name: 'red', password: 'wrongpass'}))).status, 401);
  assert.equal((await api(authReq('login', {name: 'nobody', password: 'wrongpass'}))).status, 401);
  const login = await api(authReq('login', {name: 'red', password: 'hunter22x'}));
  assert.equal(login.status, 200);
  assert.deepEqual(login.body, {user: {name: 'R.e.d'}}, 'display spelling comes from the account');
  const out = await api(authReq('logout', {}));
  assert.equal(out.status, 204);
  assert.match(out.setCookie!, /Max-Age=0/);
  assert.equal(((await api(authReq('me', undefined, {cookie: 'rollmons_session=garbage'}))).body as {user: unknown}).user, null);
  assert.equal((await api(authReq('delete', {}))).status, 404);
  assert.equal((await api(authReq('login'))).status, 405);

  for (let i = 2; i <= 5; i++) assert.equal((await api(authReq('register', {name: `p${i}`, password: 'hunter22x'}))).status, 201);
  assert.equal((await api(authReq('register', {name: 'p6', password: 'hunter22x'}))).status, 429, 'fifth account today was the last');
  assert.equal((await api(authReq('register', {name: 'p6', password: 'hunter22x', }, {ip: '198.51.100.1'}))).status, 201, 'another network');
  clock += 25 * 3_600_000;
  assert.equal((await api(authReq('register', {name: 'p7', password: 'hunter22x'}))).status, 201, 'the window has rolled over');
});

test('a verified run posted by a signed-in player is stored and ranked by personal best', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 'test-secret'});
  const session = async (name: string) => cookieOf(await api(authReq('register', {name, password: 'hunter22x'})));
  const red = await session('Red');
  const proof = proofFor(21);

  assert.equal((await api(req('POST', {proof}))).status, 401, 'guests cannot post');
  assert.equal((await api(req('POST', {proof, name: 'Spoof'}, {cookie: 'rollmons_session=x.y'}))).status, 401);
  const first = await api(req('POST', {proof}, {cookie: red}));
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const body = first.body as {rank: number; score: number; best: number};
  assert.equal(body.rank, 1);
  assert.equal(body.best, body.score);
  assert.equal(store.rows[0].name, 'Red', 'the name is the account, never the request');
  assert.equal(store.rows[0].userId, 1);
  assert.equal(store.rows[0].team.length, 6);

  assert.equal((await api(req('POST', {proof}, {cookie: red}))).status, 409, 'same run, same account');
  assert.equal((await api(req('POST', {proof: {...proof, seed: proof.seed + 1}}, {cookie: red}))).status, 422);
  assert.equal((await api(req('POST', {proof: null}, {cookie: red}))).status, 422);
  assert.equal((await api({...req('POST'), body: '{not json', cookie: red})).status, 400);
  assert.equal((await api({...req('POST'), body: 'x'.repeat(600 * 1024), cookie: red})).status, 413);
  assert.equal((await api(req('DELETE'))).status, 405);
  assert.equal((await api({...req('GET'), path: '/api/other'})).status, 404);

  const blue = await session('Blue');
  const second = await api(req('POST', {proof: proofFor(5)}, {cookie: blue}));
  assert.equal(second.status, 201);
  const third = await api(req('POST', {proof: proofFor(8)}, {cookie: blue}));
  assert.equal(third.status, 201);
  const list = (await api(req('GET', undefined, {query: 'limit=10'}))).body as {entries: Entry[]};
  assert.equal(list.entries.length, 2, 'one row per player');
  assert.ok(list.entries[0].score >= list.entries[1].score);
  assert.equal(store.rows.length, 3, 'every run is kept');
  const blueBest = Math.max(...store.rows.filter((r) => r.userId === 2).map((r) => r.score));
  assert.equal(list.entries.find((e) => e.name === 'Blue')!.score, blueBest);
  assert.equal((third.body as {best: number}).best, blueBest);
  assert.ok(!('proof' in list.entries[0]), 'listings never include the proof');
});
