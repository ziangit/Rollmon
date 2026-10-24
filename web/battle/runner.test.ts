// The runner without the wasm engine: a failing engine makes every decision a
// random legal fallback, which is enough to exercise the sim loop, the
// streamed log (docs/ROADMAP.md §4), and the choice replay (§7).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Teams} from '@pkmn/sim';
import {distinctNicknames, ReplayMismatchError, replayBattle, runBattle, type Engine} from './runner.ts';
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
  assert.ok(!outcome.log.some((l) => l.startsWith('|debug|')), 'the sim\'s debug notes (Custom Game is a debug format) are not shown in replays');
  assert.equal(outcome.fallbacks, outcome.problems.filter((p) => p.startsWith('engine error')).length);
});

test('a battle replays exactly from its recorded choices, and tampering is detected', () => {
  const original = runBattle({engine: noEngine, p1: team('Ash'), p2: team('Geeta'), seed: 11, budgetMs: {p1: 1, p2: 1}});
  assert.ok(original.choices.length >= original.turns, 'at least one accepted choice per turn');
  const again = replayBattle({p1: team('Ash'), p2: team('Geeta'), seed: 11, choices: original.choices});
  assert.equal(again.winner, original.winner);
  assert.equal(again.turns, original.turns);
  assert.deepEqual(again.log.filter((l) => !l.startsWith('|t:|')), original.log.filter((l) => !l.startsWith('|t:|')), 'same log apart from timestamps');
  assert.deepEqual(again.choices, original.choices);

  const base = {p1: team('Ash'), p2: team('Geeta'), seed: 11};
  assert.throws(() => replayBattle({...base, choices: original.choices.slice(0, -1)}), ReplayMismatchError, 'truncated');
  assert.throws(() => replayBattle({...base, choices: [...original.choices, {side: 'p1', choice: 'move 1'}]}), ReplayMismatchError, 'extra choice');
  assert.throws(() => replayBattle({...base, choices: original.choices.map((c, i) => (i === 0 ? {...c, side: c.side === 'p1' ? 'p2' : 'p1'} : c))}), ReplayMismatchError, 'wrong side');
  assert.throws(() => replayBattle({...base, choices: original.choices.map((c, i) => (i === 2 ? {...c, choice: 'move 9'} : c))}), ReplayMismatchError, 'illegal choice');
  assert.throws(() => replayBattle({...base, seed: 12, choices: original.choices}), ReplayMismatchError, 'another seed diverges');
});

test('two formes of one species get distinct nicknames so their replay idents differ', () => {
  const two = Teams.import('Arceus-Fairy @ Pixie Plate\nAbility: Multitype\n- Judgment\n\nArceus-Rock @ Stone Plate\nAbility: Multitype\n- Judgment\n\nSalamence @ Leftovers\nAbility: Intimidate\n- Roost')!;
  assert.deepEqual(distinctNicknames(two).map((m) => m.name), ['Arceus Fairy', 'Arceus Rock', '']);
  const lone = team('Cynthia').team;
  assert.deepEqual(distinctNicknames(lone), lone, 'a team without a repeated species is untouched');
  const out = runBattle({engine: noEngine, p1: {name: 'P', team: two.concat(team('Cynthia').team.slice(0, 3))}, p2: team('Leon'), seed: 3});
  assert.ok(out.log.some((l) => l.startsWith('|switch|p1a: Arceus Fairy|')), 'the replay names the forme');
  assert.ok(!out.log.some((l) => /^\|(switch|drag)\|p1a: Arceus\|/.test(l)), 'no bare "Arceus" ident');
});

test('revival blessing: the runner picks the fainted target itself and the battle goes on', () => {
  // Magikarp faints turn 1; Pawmot then uses Revival Blessing, which pauses the
  // turn with a switch-shaped request whose only legal target is the fainted
  // teammate. Before the fix the legal map held the healthy bench instead, the
  // sim rejected every retry, and the battle aborted (found by a player).
  // six per side (the engine state mapper requires full teams); the filler never acts
  const filler = (names: string[]) => names.map((n) => `${n}\nAbility: Run Away\n- Splash`).join('\n\n');
  const p1 = Teams.import('Magikarp\nAbility: Swift Swim\n- Splash\n\nPawmot @ Leppa Berry\nAbility: Iron Fist\n- Revival Blessing\n- Mach Punch\n- Close Combat\n- Thunder Punch\n\n' + filler(['Sentret', 'Zigzagoon', 'Bidoof', 'Lillipup']))!;
  const p2 = Teams.import('Garchomp\nAbility: Rough Skin\n- Earthquake\n- Dragon Claw\n- Stone Edge\n- Swords Dance\n\n' + filler(['Rattata', 'Patrat', 'Yungoos', 'Skwovet', 'Wooper']))!;
  // slot-0 move with every visit: Pawmot revives whenever the move is usable
  const firstMove: Engine = {engine_version: () => 'stub', mcts: () => JSON.stringify({iterations: 1, s1: [{choice: {kind: 'move', index: 0, label: 'm0'}, score: 0, visits: 100}, {choice: {kind: 'switch', index: 0, label: 's0'}, score: 0, visits: 1}, {choice: {kind: 'switch', index: 1, label: 's1'}, score: 0, visits: 1}], s2: [{choice: {kind: 'move', index: 0, label: 'm0'}, score: 0, visits: 100}]})};
  const events: string[] = [];
  const outcome = runBattle({engine: firstMove, p1: {name: 'P', team: p1}, p2: {name: 'B', team: p2}, seed: 5, budgetMs: {p1: 1, p2: 1}, onTurn: (e) => { if (e.source === 'forced') events.push(`${e.side} ${e.choice}`); }});
  assert.ok(outcome.log.some((l) => l.includes('[from] move: Revival Blessing')), 'the revive resolved');
  assert.deepEqual(events, ['p1 switch 2'], 'the revive target was decided without the engine, exactly once');
  assert.ok(!outcome.problems.some((p) => p.includes('rejected') || p.includes('aborting')), `no rejected choices: ${outcome.problems}`);
  assert.equal(outcome.winner, 'B');
  // the recorded choices replay cleanly, revive included (leaderboard proofs)
  const again = replayBattle({p1: {name: 'P', team: p1}, p2: {name: 'B', team: p2}, seed: 5, choices: outcome.choices});
  assert.equal(again.turns, outcome.turns);
});
