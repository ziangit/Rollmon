// Web Worker entry: loads the wasm engine, runs one battle, streams turn
// events back, then posts the outcome. Never runs on the UI thread.
import {Teams, type PokemonSet} from '@pkmn/sim';
import init, * as engine from '../../engine/pkg/rollmons_engine.js';
import {runBattle, type BattleConfig, type Outcome, type TurnEvent} from './runner.ts';

/** Teams arrive as a Showdown export (parsed here, so the page never bundles the sim) or already parsed. */
export interface WorkerTeam { name: string; team: string | PokemonSet[] }
export type WorkerRequest = {type: 'battle'; p1: WorkerTeam; p2: WorkerTeam} & Omit<BattleConfig, 'engine' | 'onTurn' | 'rng' | 'p1' | 'p2'>;
export type WorkerResponse =
  | {type: 'ready'; version: string}
  | {type: 'turn'; event: TurnEvent}
  | {type: 'done'; outcome: Outcome}
  | {type: 'error'; message: string};

const post = (m: WorkerResponse) => self.postMessage(m);

const ready = init().then(() => post({type: 'ready', version: engine.engine_version()}));

function parseTeam(side: 'p1' | 'p2', t: WorkerTeam): {name: string; team: PokemonSet[]} {
  if (typeof t.team !== 'string') return {name: t.name, team: t.team};
  const team = Teams.import(t.team);
  if (!team || !team.length) throw new Error(`${side}: could not import team export`);
  return {name: t.name, team};
}

self.onmessage = async ({data}: MessageEvent<WorkerRequest>) => {
  if (data.type !== 'battle') return;
  try {
    await ready;
    const outcome = runBattle({...data, p1: parseTeam('p1', data.p1), p2: parseTeam('p2', data.p2), engine, onTurn: (event) => post({type: 'turn', event})});
    post({type: 'done', outcome});
  } catch (err) {
    post({type: 'error', message: (err as Error).stack ?? String(err)});
  }
};
