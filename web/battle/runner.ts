// Environment-agnostic battle loop: @pkmn/sim `Battle` as referee, poke-engine
// (wasm) MCTS for both sides from the omniscient state. Runs synchronously;
// callers put it in a Web Worker (worker.ts) or a Node script (scripts/).
// `replayBattle` re-runs a battle from its recorded choices with the sim alone
// (no search), which is how a leaderboard submission is verified.
import {Battle, Dex, extractChannelMessages, type PokemonSet, type PRNGSeed} from '@pkmn/sim';
import {battleToEngineState} from './engine-state.ts';
import {legalChoices, needsDecision, pickChoice, requestOf, type MctsResult, type SideResult} from './driver.ts';
import {mulberry32} from '../game/rng.ts';

export {mulberry32};

// v1 also listed "Z-Move Clause" and "CFZ Clause"; @pkmn/sim 0.10.11 has
// neither rule and gen9 has no Z-moves, so they are dropped here. "Species
// Clause" (v1, and still in the Python reference's format) is dropped too:
// Custom Game never validates it, it has no in-battle effect, and the hosted
// replay client reads the rule as "a repeated species must be an Illusion"
// and draws a Zoroark in the team bar when a team has two Arceus formes.
export const RULES = ['+Past', 'Dynamax Clause', 'Terastal Clause', '!! Max Move Count = 4', 'Adjust Level = 100'];
export const FORMAT = `gen9customgame@@@${RULES.join(',')}`;

/** The omniscient channel of the sim's log. Custom Game is a debug format in
 *  Showdown, so the sim also writes `|debug|` notes ("natural status immunity",
 *  "weather immunity"); the replay player prints those, so they are dropped. */
function omniscientLines(raw: string[]): string[] {
  return extractChannelMessages(raw.join('\n'), [-1])[-1].filter((l) => !l.startsWith('|debug|'));
}

/** Default think time per decision (docs/DIFFICULTY.md knobs). */
export const DEFAULT_BUDGET_MS = {p1: 100, p2: 25};

/** The subset of the wasm module the runner needs (see engine/src/lib.rs). */
export interface Engine {
  mcts(state: string, maxTimeMs: number, maxIterations: number): string;
  engine_version(): string;
}

export interface Team { name: string; team: PokemonSet[] }

export type SideId = 'p1' | 'p2';

export interface TurnEvent {
  /** engine state string the decision was searched from (debugging aid) */
  state: string;
  turn: number;
  side: SideId;
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
  /** omniscient protocol lines appended since the last call (feeds the live replay) */
  onLog?: (lines: string[]) => void;
}

/** One accepted decision, in submission order: the run proof for a leaderboard entry. */
export interface Choice { side: SideId; choice: string }

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
  /** every choice the sim accepted, in order (replayBattle reproduces the battle from them) */
  choices: Choice[];
}

export class ReplayMismatchError extends Error {}

interface LoopConfig {
  p1: Team;
  p2: Team;
  seed?: number;
  onLog?: (lines: string[]) => void;
  /**
   * Decide for `side`; `legal` maps a canonical key to the sim choice string.
   * Returns the choice to submit plus bookkeeping; a rejected choice is retried
   * with `fallbackOf`, and `null` from it aborts the battle.
   */
  decide(side: SideId, legal: Map<string, string>, state: () => string, battle: Battle): {choice: string; fallback: boolean; problem?: string};
  fallbackOf(side: SideId, rejected: string, legal: Map<string, string>, battle: Battle): string | null;
}

/**
 * Two formes of one species on a team (the draft offers Arceus formes as
 * separate species) would both be named after the base species, so their
 * protocol idents collide ("p1a: Arceus"); the hosted replay client then
 * assumes an Illusion user and draws a Zoroark in the team bar. Name such
 * members "Arceus Fairy" instead (the sim resets a nickname equal to the
 * species string back to the base species, hence the space). Nicknames do
 * not affect the sim's mechanics or RNG, so recorded choices replay unchanged.
 */
export function distinctNicknames(team: PokemonSet[]): PokemonSet[] {
  const base = (m: PokemonSet) => Dex.species.get(m.species).baseSpecies || m.species;
  const counts = new Map<string, number>();
  for (const m of team) counts.set(base(m), (counts.get(base(m)) ?? 0) + 1);
  return team.map((m) => {
    const forme = Dex.species.get(m.species).forme;
    return !m.name && forme && (counts.get(base(m)) ?? 0) > 1 ? {...m, name: `${base(m)} ${forme}`} : m;
  });
}

function play(cfg: LoopConfig): Outcome {
  const seedNum = cfg.seed ?? 1;
  const seed = `sodium,${(seedNum >>> 0).toString(16).padStart(16, '0')}` as PRNGSeed;
  const battle = new Battle({formatid: FORMAT as never, seed, strictChoices: true});
  battle.setPlayer('p1', {...cfg.p1, team: distinctNicknames(cfg.p1.team)});
  battle.setPlayer('p2', {...cfg.p2, team: distinctNicknames(cfg.p2.team)});

  let fallbacks = 0;
  const problems: string[] = [];
  const choices: Choice[] = [];
  const t0 = now();
  let logIndex = 0;
  const flushLog = () => {
    if (!cfg.onLog || battle.log.length === logIndex) return;
    const raw = battle.log.slice(logIndex);
    logIndex = battle.log.length;
    // the sim appends a |split| block in one call, so a slice never cuts one in half
    const lines = omniscientLines(raw).filter((l) => l !== '');
    if (lines.length) cfg.onLog(lines);
  };

  // `battle.choose` commits the turn itself once every side's choice is in,
  // so this loop only has to answer each outstanding request.
  let guard = 0;
  while (!battle.ended && guard++ < 5000) {
    flushLog();
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
    let stateCache: string | null = null;
    const state = () => (stateCache ??= battleToEngineState(battle, {p1ForceSwitch: !!reqs[0]?.forceSwitch, p2ForceSwitch: !!reqs[1]?.forceSwitch}));
    for (const side of pending) {
      const id = side.id as SideId;
      const legal = legalChoices(requestOf(side) as never);
      const decision = cfg.decide(id, legal, state, battle);
      if (decision.fallback) fallbacks++;
      if (decision.problem) problems.push(decision.problem);
      let choice = decision.choice;
      if (!battle.choose(id, choice)) {
        problems.push(`sim rejected '${choice}' for ${id} on turn ${battle.turn}`);
        const retry = cfg.fallbackOf(id, choice, legal, battle);
        if (retry === null || !battle.choose(id, retry)) { problems.push('no accepted choice; aborting'); return finish(); }
        choice = retry;
        fallbacks++;
      }
      choices.push({side: id, choice});
    }
  }
  return finish();

  function finish(): Outcome {
    flushLog();
    const log = omniscientLines(battle.log);
    return {
      winner: battle.winner ?? '(none)',
      turns: battle.turn,
      ms: Math.round(now() - t0),
      megas: log.filter((l) => l.startsWith('|-mega|')).length,
      fallbacks,
      problems,
      log,
      choices,
    };
  }
}

export function runBattle(cfg: BattleConfig): Outcome {
  const seedNum = cfg.seed ?? 1;
  const budget = cfg.budgetMs ?? DEFAULT_BUDGET_MS;
  const rng = cfg.rng ?? mulberry32(seedNum);
  const randomLegal = (legal: Map<string, string>) => { const all = [...legal.values()]; return all[Math.floor(rng() * all.length)]; };
  return play({
    p1: cfg.p1, p2: cfg.p2, seed: cfg.seed, onLog: cfg.onLog,
    decide(id, legal, state, battle) {
      let out: {choice: string; fallback: boolean; problem?: string};
      let event: TurnEvent;
      try {
        const result: MctsResult = JSON.parse(cfg.engine.mcts(state(), budget[id], 0));
        const pick = pickChoice(id === 'p1' ? result.s1 : result.s2, legal, rng);
        out = {choice: pick.choice, fallback: pick.source === 'fallback', problem: pick.source === 'fallback' ? `fallback turn ${battle.turn} ${id}: ${pick.reason}` : undefined};
        event = {state: state(), turn: battle.turn, side: id, choice: pick.choice, iterations: result.iterations, candidates: pick.candidates, source: pick.source};
      } catch (err) {
        out = {choice: randomLegal(legal), fallback: true, problem: `engine error turn ${battle.turn} ${id}: ${(err as Error).message}`};
        event = {state: state(), turn: battle.turn, side: id, choice: out.choice, iterations: 0, candidates: [], source: 'fallback'};
      }
      cfg.onTurn?.(event);
      return out;
    },
    fallbackOf(_id, rejected, legal) {
      const rest = [...legal.values()].filter((c) => c !== rejected);
      return rest.length ? rest[0] : null;
    },
  });
}

export interface ReplayConfig { p1: Team; p2: Team; seed?: number; choices: Choice[]; onLog?: (lines: string[]) => void }

/**
 * Re-run a battle from its recorded choices with the simulator only. The sim
 * is seeded, so the result and log are identical to the original battle;
 * any deviation (wrong side, a choice the sim rejects, too few or too many
 * choices) throws ReplayMismatchError.
 */
export function replayBattle(cfg: ReplayConfig): Outcome {
  let next = 0;
  let outcome: Outcome;
  try {
    outcome = play({
      p1: cfg.p1, p2: cfg.p2, seed: cfg.seed, onLog: cfg.onLog,
      decide(id, _legal, _state, battle) {
        const c = cfg.choices[next++];
        if (!c) throw new ReplayMismatchError(`ran out of choices at turn ${battle.turn} (${id})`);
        if (c.side !== id) throw new ReplayMismatchError(`choice ${next} is for ${c.side}, the sim asked ${id} (turn ${battle.turn})`);
        return {choice: c.choice, fallback: false};
      },
      fallbackOf(id, rejected, _legal, battle) {
        throw new ReplayMismatchError(`the sim rejected '${rejected}' for ${id} on turn ${battle.turn}`);
      },
    });
  } catch (err) {
    // strictChoices makes the sim throw on an illegal choice; the proof is untrusted input
    if (err instanceof ReplayMismatchError) throw err;
    throw new ReplayMismatchError((err as Error).message);
  }
  if (next !== cfg.choices.length) throw new ReplayMismatchError(`${cfg.choices.length - next} recorded choices were never used`);
  if (outcome.problems.length) throw new ReplayMismatchError(outcome.problems.join('; '));
  return outcome;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
