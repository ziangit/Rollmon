// Turns an MCTS result into a sim choice string, filtered by what the sim's
// request actually allows. Keeps v1's rule: among choices whose visit count is
// at least 75 % of the most visited one, sample proportionally to visits.
import type {Side} from '@pkmn/sim';

export interface EngineChoice {
  kind: 'move' | 'switch' | 'none';
  index: number;
  mega?: boolean;
  label: string;
}
export interface SideResult { choice: EngineChoice; score: number; visits: number }
export interface MctsResult { iterations: number; s1: SideResult[]; s2: SideResult[] }

interface MoveReq { id: string; disabled?: boolean | string }
interface ActiveReq { moves: MoveReq[]; trapped?: boolean; canMegaEvo?: boolean }
interface Request {
  wait?: boolean;
  teamPreview?: boolean;
  forceSwitch?: boolean[];
  active?: ActiveReq[];
  side: {pokemon: {active: boolean; condition: string; moves: string[]; reviving?: boolean}[]};
}

export const CANDIDATE_VISIT_RATIO = 0.75;

/** Sim choice strings this request allows, keyed by the engine's structured form. */
export function legalChoices(req: Request): Map<string, string> {
  const legal = new Map<string, string>();
  const bench = req.side.pokemon;
  const canSwitchTo = (i: number) => bench[i] && !bench[i].active && !bench[i].condition.endsWith(' fnt');
  if (req.forceSwitch) {
    // Revival Blessing pauses the turn with a switch-shaped request whose only
    // legal targets are *fainted* party members (the mon to revive). The sim
    // marks the user with `reviving`; `revive:` keys never match an engine
    // choice, so the runner decides the target itself (the engine's model has
    // no mid-turn revive decision).
    if (bench.some((p) => p.reviving)) {
      for (let i = 0; i < bench.length; i++) if (!bench[i].active && bench[i].condition.endsWith(' fnt')) legal.set(`revive:${i}`, `switch ${i + 1}`);
      return legal;
    }
    for (let i = 0; i < bench.length; i++) if (canSwitchTo(i)) legal.set(`switch:${i}`, `switch ${i + 1}`);
    return legal;
  }
  const active = req.active?.[0];
  if (!active) return legal;
  // While locked into a move (Outrage, a charge turn, Recharge, Struggle) the
  // request lists just that move, so request index != move-slot index. The
  // engine's index is the slot; `side.pokemon[active].moves` is in slot order.
  const slots = bench.find((p) => p.active)?.moves ?? [];
  const single = active.moves.length === 1;
  active.moves.forEach((m, i) => {
    if (m.disabled) return;
    const slot = slots.indexOf(m.id);
    const cmd = `move ${i + 1}`;
    if (slot >= 0) {
      legal.set(`move:${slot}`, cmd);
      if (active.canMegaEvo) legal.set(`move:${slot}:mega`, `${cmd} mega`);
    }
    // Recharge/Struggle are not in any slot; the engine reports them as "none".
    if (single) legal.set('none', cmd);
  });
  if (!active.trapped) {
    for (let i = 0; i < bench.length; i++) if (canSwitchTo(i)) legal.set(`switch:${i}`, `switch ${i + 1}`);
  }
  return legal;
}

export function choiceKey(c: EngineChoice): string {
  if (c.kind === 'move') return c.mega ? `move:${c.index}:mega` : `move:${c.index}`;
  if (c.kind === 'switch') return `switch:${c.index}`;
  return 'none';
}

export interface Pick { choice: string; source: 'mcts' | 'fallback'; candidates: SideResult[]; reason?: string }

export function pickChoice(results: SideResult[], legal: Map<string, string>, rng: () => number): Pick {
  const usable = results.filter((r) => legal.has(choiceKey(r.choice)) && r.visits > 0);
  if (usable.length === 0) {
    const all = [...legal.values()];
    const reason = `engine offered [${results.map((r) => `${choiceKey(r.choice)}=${r.visits}`).join(' ')}] but sim allows [${[...legal.keys()].join(' ')}]`;
    return {choice: all[Math.floor(rng() * all.length)], source: 'fallback', candidates: [], reason};
  }
  const best = Math.max(...usable.map((r) => r.visits));
  const candidates = usable.filter((r) => r.visits >= CANDIDATE_VISIT_RATIO * best);
  const total = candidates.reduce((a, r) => a + r.visits, 0);
  let roll = rng() * total;
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) { roll -= c.visits; if (roll <= 0) { chosen = c; break; } }
  return {choice: legal.get(choiceKey(chosen.choice))!, source: 'mcts', candidates};
}

export function requestOf(side: Side): Request | null {
  return side.activeRequest as Request | null;
}

export function needsDecision(req: Request | null): boolean {
  return !!req && !req.wait && (!!req.forceSwitch || !!req.active);
}
