// Page-side handle on the battle Web Worker: one battle at a time, as a
// promise, with per-turn progress callbacks. The page never touches the
// simulator or the engine directly.
import type {Outcome, TurnEvent} from './runner.ts';
import type {WorkerRequest, WorkerResponse} from './worker.ts';

export interface BattleJob {
  p1: {name: string; team: string};
  p2: {name: string; team: string};
  seed?: number;
  budgetMs?: {p1: number; p2: number};
  onTurn?: (e: TurnEvent) => void;
  /** protocol lines as the battle produces them, in order; their concatenation is the outcome's log */
  onLog?: (lines: string[]) => void;
}

export class BattleClient {
  private readonly worker: Worker;
  private readonly readyPromise: Promise<string>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(worker: Worker) {
    this.worker = worker;
    this.readyPromise = new Promise((resolve, reject) => {
      const onReady = ({data}: MessageEvent<WorkerResponse>) => {
        if (data.type === 'ready') { this.worker.removeEventListener('message', onReady); resolve(data.version); }
        if (data.type === 'error') { this.worker.removeEventListener('message', onReady); reject(new Error(data.message)); }
      };
      this.worker.addEventListener('message', onReady);
      this.worker.addEventListener('error', (e) => reject(new Error(e.message)), {once: true});
    });
  }

  /** Resolves with the engine version once the wasm module is loaded. */
  ready(): Promise<string> { return this.readyPromise; }

  /** Run one battle; jobs are serialised so the worker only ever runs one. */
  run(job: BattleJob): Promise<Outcome> {
    const next = this.queue.then(() => this.runNow(job));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runNow(job: BattleJob): Promise<Outcome> {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      const onMessage = ({data}: MessageEvent<WorkerResponse>) => {
        if (data.type === 'turn') job.onTurn?.(data.event);
        else if (data.type === 'log') job.onLog?.(data.lines);
        else if (data.type === 'done') { cleanup(); resolve(data.outcome); }
        else if (data.type === 'error') { cleanup(); reject(new Error(data.message)); }
      };
      const onError = (e: ErrorEvent) => { cleanup(); reject(new Error(e.message)); };
      const cleanup = () => { this.worker.removeEventListener('message', onMessage); this.worker.removeEventListener('error', onError); };
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      const req: WorkerRequest = {type: 'battle', p1: job.p1, p2: job.p2, seed: job.seed, budgetMs: job.budgetMs};
      this.worker.postMessage(req);
    });
  }
}
