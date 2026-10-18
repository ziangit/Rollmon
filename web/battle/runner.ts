// Environment-agnostic battle loop: @pkmn/sim `Battle` as referee, poke-engine
// (wasm) MCTS for both sides from the omniscient state. Runs synchronously;
// callers put it in a Web Worker (worker.ts) or a Node script (scripts/).
import {Battle, extractChannelMessages, type PokemonSet, type PRNGSeed} from '@pkmn/sim';
import {battleToEngineState} from './engine-state.ts';
import {legalChoices, needsDecision, pickChoice, requestOf, type MctsResult, type SideResult} from './driver.ts';
import {mulberry32} from '../game/rng.ts';

export {mulberry32};

// v1 also listed "Z-Move Clause" and "CFZ Clause"; @pkmn/sim 0.10.11 has
// neither rule and gen9 has no Z-moves, so they are dropped here.
export const RULES = ['Species Clause', '+Past', 'Dynamax Clause', 'Terastal Clause', '!! Max Move Count = 4', 'Adjust Level = 100'];
export const FORMAT = `gen9customgame@@@${RULES.join(',')}`;

/** Default think time per decision (docs/DIFFICULTY.md knobs). */
export const DEFAULT_BUDGET_MS = {p1: 100, p2: 25};

/** The subset of the wasm module the runner needs (see engine/src/lib.rs). */
export interface Engine {
  mcts(state: string, maxTimeMs: number, maxIterations: number): string;
  engine_version(): string;
}

export interface Team { name: string; team: PokemonSet[] }

export interface TurnEvent {
  /** engine state string the decision was searched from (debugging aid) */
  state: string;
  turn: number;
  side: 'p1' | 'p2';
  choice: string;
  iterations: number;
  candidates: SideResult[];
  source: 'mcts' | 'fallback';
}

export interface BattleConfig {
  engine: Engine;
  p1: Team;
  p2: Team;
  seed?: number;
  budgetMs?: {p1: number; p2: number};
  /** uniform [0,1) source for choice sampling; defaults to a seeded PRNG */
  rng?: () => number;
  onTurn?: (e: TurnEvent) => void;
}

export interface Outcome {
  winner: string;
  turns: number;
  ms: number;
  megas: number;
  fallbacks: number;
  /** anything that should not happen in a healthy battle (engine errors, sim rejections) */
  problems: string[];
  /** omniscient Showdown protocol log, one line per entry (feeds the replay embed) */
  log: string[];
}

export function runBattle(cfg: BattleConfig): Outcome {
  const seedNum = cfg.seed ?? 1;
  const seed = `sodium,${(seedNum >>> 0).toString(16).padStart(16, '0')}` as PRNGSeed;
  const budget = cfg.budgetMs ?? DEFAULT_BUDGET_MS;
  const rng = cfg.rng ?? mulberry32(seedNum);
  const battle = new Battle({formatid: FORMAT as never, seed, strictChoices: true});
  battle.setPlayer('p1', cfg.p1);
  battle.setPlayer('p2', cfg.p2);

  let fallbacks = 0;
  const problems: string[] = [];
  const t0 = now();

  // `battle.choose` commits the turn itself once every side's choice is in,
  // so this loop only has to answer each outstanding request.
  let guard = 0;
  while (!battle.ended && guard++ < 5000) {
    const reqs = battle.sides.map((s) => requestOf(s));
    if (reqs.some((r) => r?.teamPreview)) {
      // Custom Game has Team Preview; keep file order (lead = first listed).
      for (const side of battle.sides) if (!side.isChoiceDone()) battle.choose(side.id, 'default');
      continue;
    }
    const pending = battle.sides.filter((s, i) => needsDecision(reqs[i]) && !s.isChoiceDone());
    if (pending.length === 0) {
      problems.push(`stuck at turn ${battle.turn}: ${battle.sides.map((s) => `${s.id}=${s.requestState || 'wait'}/${s.isChoiceDone()}`).join(' ')}`);
      break;
    }
    const state = battleToEngineState(battle, {
      p1ForceSwitch: !!reqs[0]?.forceSwitch,
      p2ForceSwitch: !!reqs[1]?.forceSwitch,
    });
    for (const side of pending) {
      const id = side.id as 'p1' | 'p2';
      const legal = legalChoices(requestOf(side) as never);
      let choice: string;
      let event: TurnEvent;
      try {
        const result: MctsResult = JSON.parse(cfg.engine.mcts(state, budget[id], 0));
        const pick = pickChoice(id === 'p1' ? result.s1 : result.s2, legal, rng);
        if (pick.source === 'fallback') { fallbacks++; problems.push(`fallback turn ${battle.turn} ${id}: ${pick.reason}`); }
        choice = pick.choice;
        event = {state, turn: battle.turn, side: id, choice, iterations: result.iterations, candidates: pick.candidates, source: pick.source};
      } catch (err) {
        fallbacks++;
        problems.push(`engine error turn ${battle.turn} ${id}: ${(err as Error).message}`);
        const all = [...legal.values()];
        choice = all[Math.floor(rng() * all.length)];
        event = {state, turn: battle.turn, side: id, choice, iterations: 0, candidates: [], source: 'fallback'};
      }
      cfg.onTurn?.(event);
      if (!battle.choose(id, choice)) {
        problems.push(`sim rejected '${choice}' for ${id} on turn ${battle.turn}`);
        const rest = [...legal.values()].filter((c) => c !== choice);
        if (!rest.length || !battle.choose(id, rest[0])) { problems.push('no accepted choice; aborting'); return finish(); }
        fallbacks++;
      }
    }
  }
  return finish();

  function finish(): Outcome {
    const log = extractChannelMessages(battle.log.join('\n'), [-1])[-1];
    return {
      winner: battle.winner ?? '(none)',
      turns: battle.turn,
      ms: Math.round(now() - t0),
      megas: log.filter((l) => l.startsWith('|-mega|')).length,
      fallbacks,
      problems,
      log,
    };
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
