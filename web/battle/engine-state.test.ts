import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Battle, Teams} from '@pkmn/sim';
import {battleToEngineState} from './engine-state.ts';
import {FORMAT} from './runner.ts';
import {loadEngine, REPO_ROOT} from '../scripts/load-engine.ts';

const team = (f: string) => Teams.import(readFileSync(`${REPO_ROOT}rollmons/${f}`, 'utf8'))!;

function startedBattle() {
  const battle = new Battle({formatid: FORMAT as never, seed: 'sodium,0000000000000001' as never});
  battle.setPlayer('p1', {name: 'A', team: team('pool/advanced/Cynthia.txt')});
  battle.setPlayer('p2', {name: 'B', team: team('bosses/leon.txt')});
  battle.choose('p1', 'default');
  battle.choose('p2', 'default');
  return battle;
}

test('state has the documented shape', () => {
  const state = battleToEngineState(startedBattle());
  const parts = state.split('/');
  assert.equal(parts.length, 6, 'side1/side2/weather/terrain/trickroom/teampreview');
  for (const side of parts.slice(0, 2)) {
    const fields = side.split('=');
    assert.equal(fields.length, 29, 'Side::deserialize reads 29 `=`-separated fields');
    for (const pkmn of fields.slice(0, 6)) {
      assert.equal(pkmn.split(',').length, 29, 'Pokemon::deserialize reads 29 `,`-separated fields');
    }
    assert.equal(fields[6], '0', 'lead is the first listed Pokémon');
    assert.equal(fields[7].split(';').length, 19, 'side conditions');
    assert.equal(fields[9].split(';').length, 6, 'volatile durations');
  }
  assert.equal(parts[2], 'NONE;0');
  assert.equal(parts[5], 'false');
});

test('Pokémon fields follow poke-engine spelling', () => {
  const state = battleToEngineState(startedBattle());
  const garchomp = state.split('/')[0].split('=')[0].split(',');
  assert.equal(garchomp[0], 'GARCHOMP');
  assert.equal(garchomp[1], '100');
  assert.deepEqual(garchomp.slice(2, 6), ['DRAGON', 'GROUND', 'DRAGON', 'GROUND']);
  assert.equal(garchomp[6], garchomp[7], 'full hp at start');
  assert.match(garchomp[8], /^[A-Z]+$/);
  assert.match(garchomp[22], /^[A-Z0-9]+;false;\d+$/, 'move;disabled;pp');
  assert.equal(garchomp[26], 'false', 'not mega evolved');
  assert.equal(garchomp[27], 'false', 'never terastallized');
});

test('the engine parses the state back to the same string', async () => {
  const engine = await loadEngine();
  const state = battleToEngineState(startedBattle());
  const once = engine.serialize_roundtrip(state);
  assert.equal(engine.serialize_roundtrip(once), once);
  // species, hp and moves survive the round trip (the engine normalises
  // nothing we care about here)
  const mine = state.split('/')[0].split('=')[0].split(',');
  const theirs = once.split('/')[0].split('=')[0].split(',');
  assert.equal(theirs[0], mine[0]);
  assert.equal(theirs[6], mine[6]);
  assert.equal(theirs[22].split(';')[0], mine[22].split(';')[0]);
  const options = JSON.parse(engine.root_options(state));
  assert.equal(options.s1.length, 4 + 5, 'four moves and five switches at the start');
  assert.ok(!JSON.stringify(options).includes('-tera'));
});

test('a fainted active is not flagged force_switch; a standing one is', () => {
  const battle = startedBattle();
  const p2 = battle.sides[1];
  const flags = (s: string) => s.split('/').map((side) => side.split('=')[22]);
  assert.deepEqual(flags(battleToEngineState(battle, {p1ForceSwitch: true, p2ForceSwitch: true})).slice(0, 2), ['true', 'true']);
  p2.active[0]!.hp = 0;
  p2.active[0]!.fainted = true;
  p2.active[0]!.trapped = true; // stale from an earlier move request
  const state = battleToEngineState(battle, {p1ForceSwitch: true, p2ForceSwitch: true});
  assert.deepEqual(flags(state).slice(0, 2), ['true', 'false']);
  assert.equal(state.split('/')[1].split('=')[26], 'false', 'a fainted active is never force_trapped');
});
