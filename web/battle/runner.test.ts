// The runner without the wasm engine: a failing engine makes every decision a
// random legal fallback, which is enough to exercise the sim loop and the
// streamed log (docs/ROADMAP.md §4).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Teams} from '@pkmn/sim';
import {runBattle, type Engine} from './runner.ts';
import {loadGameData} from '../scripts/game-data.ts';

const data = loadGameData();
const team = (name: string) => ({name, team: Teams.import(data.bosses[name.toLowerCase()])!});
const noEngine: Engine = {mcts: () => { throw new Error('no engine in this test'); }, engine_version: () => 'none'};

test('streamed log chunks concatenate to the outcome log, in order', () => {
  const chunks: string[][] = [];
  const outcome = runBattle({engine: noEngine, p1: team('Cynthia'), p2: team('Leon'), seed: 3, budgetMs: {p1: 1, p2: 1}, onLog: (lines) => chunks.push(lines)});
  assert.ok(outcome.turns > 0 && outcome.log.length > 20);
  assert.deepEqual(chunks.flat(), outcome.log);
  assert.ok(chunks.length > outcome.turns / 2, 'lines arrive as the battle progresses, not in one piece at the end');
  assert.ok(chunks.every((c) => c.length > 0));
  assert.ok(outcome.log.some((l) => l.startsWith('|win|') || l === '|tie'));
  assert.equal(outcome.fallbacks, outcome.problems.filter((p) => p.startsWith('engine error')).length);
});
