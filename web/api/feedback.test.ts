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
  assert.equal((await api({...post({}), method: 'GET'})).status, 405);
  assert.equal((await api(post({kind: 'bug', text: 'x'}))).status, 400);
  assert.equal((await api(post({kind: 'feedback', text: '   '}))).status, 400);
  assert.equal((await api(post({kind: 'feedback', text: 'x'.repeat(4001)}))).status, 400);
  const res = await api(post({kind: 'feedback', text: 'the phone layout breaks', screen: 'battle', lang: 'zh', seed: 7}));
  assert.equal(res.status, 201);
  assert.equal(store.feedback.length, 1);
  const {id, createdAt, ipHash, ...row} = store.feedback[0];
  assert.ok(id > 0 && createdAt && ipHash, 'id, time and hashed address');
  assert.deepEqual(row, {kind: 'feedback', text: 'the phone layout breaks', species: null, screen: 'battle', lang: 'zh', seed: 7, agent: 'test-agent', userId: null, name: null});
});

test('a set contribution must be a Showdown export for that species', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 's3cret'});
  const set = 'Scarf (Sneasler) @ Choice Scarf\nAbility: Poison Touch\n- Close Combat\n- U-turn\n- Dire Claw\n- Throat Chop';
  assert.equal(errorOf(await api(post({kind: 'set', species: 'nosuchmon', text: set}))), 'unknown species');
  assert.match(errorOf(await api(post({kind: 'set', species: 'lucario', text: set}))), /sneasler/);
  assert.equal((await api(post({kind: 'set', species: 'sneasler', text: 'not an export'}))).status, 400);
  assert.equal((await api(post({kind: 'set', species: 'sneasler', text: set}))).status, 201);
  assert.equal(store.feedback[0].species, 'sneasler');
});

test('feedback is limited per network per day; without a store it is 503', async () => {
  const store = memoryStore();
  const api = createApi({ctx, store: async () => store, secret: 's3cret'});
  for (let i = 0; i < FEEDBACK_PER_IP_PER_DAY; i++) assert.equal((await api(post({kind: 'feedback', text: `n${i}`}))).status, 201);
  assert.equal((await api(post({kind: 'feedback', text: 'one more'}))).status, 429);
  assert.equal((await api(post({kind: 'feedback', text: 'other network'}, {ip: '198.51.100.1'}))).status, 201);
  assert.equal((await createApi({ctx, store: async () => null})(post({kind: 'feedback', text: 'x'}))).status, 503);
});
