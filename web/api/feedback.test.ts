import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApi, type ApiRequest} from './leaderboard.ts';
import {FEEDBACK_PER_IP_PER_DAY} from './feedback.ts';
import {memoryStore} from './memory.ts';
import {createGameContext} from '../app/session.ts';
import {loadGameData} from '../scripts/game-data.ts';

const ctx = createGameContext(loadGameData());
const post = (body: unknown, extra: Partial<ApiRequest> = {}): ApiRequest =>
  ({method: 'POST', path: '/api/feedback', query: new URLSearchParams(), body: JSON.stringify(body), ip: '203.0.113.9', agent: 'test-agent', ...extra});
const errorOf = (res: {body: unknown}) => (res.body as {error: string}).error;

test('feedback: free text is stored with its context; bad input is refused', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 's3cret'});
  assert.equal((await api({...post({}), method: 'GET'})).status, 401, 'reading needs the token or a developer account');
  assert.equal((await api({...post({}), method: 'PUT'})).status, 405);
  assert.equal((await api(post({kind: 'bug', text: 'x'}))).status, 400);
  assert.equal((await api(post({kind: 'feedback', text: '   '}))).status, 400);
  assert.equal((await api(post({kind: 'feedback', text: 'x'.repeat(4001)}))).status, 400);
  const res = await api(post({kind: 'feedback', text: 'the phone layout breaks', screen: 'battle', lang: 'zh', seed: 7}));
  assert.equal(res.status, 201);
  assert.equal(store.feedback.length, 1);
  const {id, createdAt, ipHash, ...row} = store.feedback[0];
  assert.ok(id > 0 && createdAt && ipHash, 'id, time and hashed address');
  assert.deepEqual(row, {kind: 'feedback', text: 'the phone layout breaks', species: null, note: null, screen: 'battle', lang: 'zh', seed: 7, agent: 'test-agent', userId: null, name: null});
});

test('a set contribution must be a Showdown export for that species', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 's3cret'});
  const set = 'Scarf (Sneasler) @ Choice Scarf\nAbility: Poison Touch\n- Close Combat\n- U-turn\n- Dire Claw\n- Throat Chop';
  const note = 'Scarf revenge killer; Dire Claw over Gunk Shot for the status roll';
  assert.equal(errorOf(await api(post({kind: 'set', species: 'nosuchmon', text: set, note}))), 'unknown species');
  assert.match(errorOf(await api(post({kind: 'set', species: 'lucario', text: set, note}))), /sneasler/);
  assert.equal((await api(post({kind: 'set', species: 'sneasler', text: 'not an export', note}))).status, 400);
  // a set comes with a one-line summary of what it does
  assert.match(errorOf(await api(post({kind: 'set', species: 'sneasler', text: set}))), /what the set does/);
  assert.match(errorOf(await api(post({kind: 'set', species: 'sneasler', text: set, note: 'x'.repeat(201)}))), /at most 200/);
  assert.equal((await api(post({kind: 'set', species: 'sneasler', text: set, note}))).status, 201);
  assert.equal(store.feedback[0].species, 'sneasler');
  assert.equal(store.feedback[0].note, note);
});

test('feedback is limited per network per day; without a store it is 503', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 's3cret'});
  for (let i = 0; i < FEEDBACK_PER_IP_PER_DAY; i++) assert.equal((await api(post({kind: 'feedback', text: `n${i}`}))).status, 201);
  assert.equal((await api(post({kind: 'feedback', text: 'one more'}))).status, 429);
  assert.equal((await api(post({kind: 'feedback', text: 'other network'}, {ip: '198.51.100.1'}))).status, 201);
  assert.equal((await createApi({ctx, store: async () => null})(post({kind: 'feedback', text: 'x'}))).status, 503);
  // the author's account has no cap, even from the exhausted network
  const reg = await api({method: 'POST', path: '/api/auth/register', query: new URLSearchParams(), body: JSON.stringify({name: 'Lonie Tzzz', password: 'hunter22x'}), ip: '203.0.113.9'});
  assert.equal(reg.status, 201);
  const cookie = reg.setCookie!.split(';')[0];
  for (let i = 0; i < FEEDBACK_PER_IP_PER_DAY + 2; i++) assert.equal((await api(post({kind: 'feedback', text: `dev ${i}`}, {cookie}))).status, 201);
  assert.equal((await api(post({kind: 'feedback', text: 'still capped'}))).status, 429, 'other visitors on that network stay capped');
});

test('the rows are readable with the read token or as a developer account, newest first, without addresses', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 's3cret', readToken: 'tok-123'});
  await api(post({kind: 'feedback', text: 'first'}));
  await api(post({kind: 'feedback', text: 'second'}));
  const get = (extra: Partial<ApiRequest> = {}) => api({method: 'GET', path: '/api/feedback', query: new URLSearchParams(), body: null, ip: '203.0.113.9', ...extra});
  assert.equal((await get()).status, 401);
  assert.equal((await get({authorization: 'Bearer wrong'})).status, 401);
  const res = await get({authorization: 'Bearer tok-123'});
  assert.equal(res.status, 200);
  const rows = (res.body as {rows: Record<string, unknown>[]}).rows;
  assert.deepEqual(rows.map((r) => r.text), ['second', 'first']);
  assert.ok(!('ipHash' in rows[0]) && !('userId' in rows[0]), 'no hashed address or user id in the listing');
  const reg = await api({method: 'POST', path: '/api/auth/register', query: new URLSearchParams(), body: JSON.stringify({name: 'lonietzzz', password: 'hunter22x'}), ip: '203.0.113.9'});
  assert.equal((await get({cookie: reg.setCookie!.split(';')[0]})).status, 200);
  assert.equal((await createApi({ctx, store: async () => store, secret: 's3cret'})(post({kind: 'feedback', text: 'x'}, {method: 'GET'} as Partial<ApiRequest>))).status, 401, 'no token configured: only developers');
});
