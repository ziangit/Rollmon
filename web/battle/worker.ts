// Web Worker entry: loads the wasm engine, runs one battle, streams turn
// events back, then posts the outcome. Never runs on the UI thread.
import init, * as engine from '../../engine/pkg/rollmons_engine.js';
import {runBattle, type BattleConfig, type Outcome, type TurnEvent} from './runner.ts';

export type WorkerRequest = {type: 'battle'} & Omit<BattleConfig, 'engine' | 'onTurn' | 'rng'>;
export type WorkerResponse =
  | {type: 'ready'; version: string}
  | {type: 'turn'; event: TurnEvent}
  | {type: 'done'; outcome: Outcome}
  | {type: 'error'; message: string};

const post = (m: WorkerResponse) => self.postMessage(m);

const ready = init().then(() => post({type: 'ready', version: engine.engine_version()}));

self.onmessage = async ({data}: MessageEvent<WorkerRequest>) => {
  if (data.type !== 'battle') return;
  try {
    await ready;
    const outcome = runBattle({...data, engine, onTurn: (event) => post({type: 'turn', event})});
    post({type: 'done', outcome});
  } catch (err) {
    post({type: 'error', message: (err as Error).stack ?? String(err)});
  }
};
