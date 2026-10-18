import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legalChoices, pickChoice, choiceKey, type SideResult} from './driver.ts';

const bench = [
  {active: true, condition: '300/300', moves: ['a', 'b', 'c', 'd']},
  {active: false, condition: '200/200'},
  {active: false, condition: '0 fnt'},
  {active: false, condition: '150/150 par'},
  {active: false, condition: '100/100'},
  {active: false, condition: '100/100'},
];
const moves = [{id: 'a'}, {id: 'b', disabled: true}, {id: 'c'}, {id: 'd'}];

test('move request: enabled moves, mega only when allowed, no switches when trapped', () => {
  const free = legalChoices({active: [{moves, canMegaEvo: true}], side: {pokemon: bench}} as never);
  assert.deepEqual([...free.keys()], ['move:0', 'move:0:mega', 'move:2', 'move:2:mega', 'move:3', 'move:3:mega', 'switch:1', 'switch:3', 'switch:4', 'switch:5']);
  assert.equal(free.get('move:2:mega'), 'move 3 mega');
  const trapped = legalChoices({active: [{moves, trapped: true}], side: {pokemon: bench}} as never);
  assert.deepEqual([...trapped.keys()], ['move:0', 'move:2', 'move:3']);
});

test('locked moves map request index to slot index; recharge maps to none', () => {
  const locked = legalChoices({active: [{moves: [{id: 'c'}], trapped: true}], side: {pokemon: bench}} as never);
  assert.deepEqual([...locked.entries()], [['move:2', 'move 1'], ['none', 'move 1']]);
  const recharge = legalChoices({active: [{moves: [{id: 'recharge'}], trapped: true}], side: {pokemon: bench}} as never);
  assert.deepEqual([...recharge.entries()], [['none', 'move 1']]);
});

test('force switch request: only live bench members', () => {
  const legal = legalChoices({forceSwitch: [true], side: {pokemon: bench}} as never);
  assert.deepEqual([...legal.values()], ['switch 2', 'switch 4', 'switch 5', 'switch 6']);
});

const r = (key: string, visits: number): SideResult => {
  const [kind, i, mega] = key.split(':');
  return {choice: {kind: kind as 'move' | 'switch', index: Number(i), mega: mega === 'mega', label: key}, score: 0, visits};
};

test('pick samples among choices within 75% of the most visited, legal only', () => {
  const legal = legalChoices({active: [{moves}], side: {pokemon: bench}} as never);
  const results = [r('move:0', 100), r('move:2', 80), r('move:3', 74), r('move:1', 1000), r('switch:2', 500)];
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(pickChoice(results, legal, Math.random).choice);
  assert.deepEqual([...seen].sort(), ['move 1', 'move 3'], 'move 4 is below the cut, move 2 and switch 3 are illegal');
  assert.equal(pickChoice(results, legal, () => 0).source, 'mcts');
});

test('pick falls back to a random legal choice when the engine offers nothing usable', () => {
  const legal = legalChoices({forceSwitch: [true], side: {pokemon: bench}} as never);
  const pick = pickChoice([{choice: {kind: 'none', index: 0, label: 'No Move'}, score: 0, visits: 10}], legal, () => 0.99);
  assert.equal(pick.source, 'fallback');
  assert.equal(pick.choice, 'switch 6');
  assert.match(pick.reason!, /engine offered \[none=10\]/);
  assert.equal(choiceKey({kind: 'switch', index: 4, label: ''}), 'switch:4');
});
