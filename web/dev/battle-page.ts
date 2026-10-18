// Dev page script: drives the battle worker, then shows the hosted replay and
// the damage summary for the finished battle.
import {Teams} from '@pkmn/sim';
import type {WorkerRequest, WorkerResponse} from '../battle/worker.ts';
import {accumulatePlayerDamage, damagePayload, gauntletDamageSummary, seedDamageTracking} from '../battle/summary.ts';
import {mountReplay} from '../replay/embed.ts';

declare global { interface Window { __outcome: unknown; __summary: unknown } }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const worker = new Worker(new URL('../dist/worker.js', import.meta.url), {type: 'module'});
const PLAYER = 'Player';
let bossName = 'Boss';

const defaults = ['../../rollmons/pool/advanced/Cynthia.txt', '../../rollmons/bosses/leon.txt'];
Promise.all(defaults.map((u) => fetch(u).then((r) => r.text()))).then(([a, b]) => {
  $<HTMLTextAreaElement>('p1').value = a;
  $<HTMLTextAreaElement>('p2').value = b;
});

worker.onmessage = ({data}: MessageEvent<WorkerResponse>) => {
  if (data.type === 'ready') { $('status').textContent = `worker ready: ${data.version}`; $<HTMLButtonElement>('run').disabled = false; }
  if (data.type === 'turn') $('trace').textContent += `T${data.event.turn} ${data.event.side} ${data.event.choice} (${data.event.iterations} it)\n`;
  if (data.type === 'done') {
    const o = data.outcome;
    $('status').textContent = `winner=${o.winner} turns=${o.turns} ${o.ms} ms megas=${o.megas} fallbacks=${o.fallbacks} problems=${o.problems.length}`;
    const roster = Teams.import($<HTMLTextAreaElement>('p1').value)?.map((s) => s.species) ?? [];
    const {totals, display} = seedDamageTracking(roster);
    accumulatePlayerDamage(totals, display, o.log, PLAYER);
    const payload = damagePayload(totals, display);
    $('summary').textContent = gauntletDamageSummary(totals, display) ?? 'No damage dealt.';
    $('replay').replaceChildren();
    mountReplay($('replay'), o.log, bossName, PLAYER);
    $('log').textContent = o.problems.concat(o.log).join('\n');
    window.__summary = payload;
    window.__outcome = o;
    $<HTMLButtonElement>('run').disabled = false;
  }
  if (data.type === 'error') { $('status').textContent = `worker error: ${data.message}`; $<HTMLButtonElement>('run').disabled = false; }
};

$('run').onclick = () => {
  $('trace').textContent = ''; $('log').textContent = ''; $('summary').textContent = ''; $('replay').replaceChildren();
  $<HTMLButtonElement>('run').disabled = true;
  window.__outcome = null;
  bossName = $<HTMLInputElement>('boss').value || 'Boss';
  const req: WorkerRequest = {
    type: 'battle',
    p1: {name: PLAYER, team: Teams.import($<HTMLTextAreaElement>('p1').value)!},
    p2: {name: bossName, team: Teams.import($<HTMLTextAreaElement>('p2').value)!},
    seed: Number($<HTMLInputElement>('seed').value),
    budgetMs: {p1: Number($<HTMLInputElement>('b1').value), p2: Number($<HTMLInputElement>('b2').value)},
  };
  worker.postMessage(req);
};

const params = new URLSearchParams(location.search);
if (params.get('seed')) $<HTMLInputElement>('seed').value = params.get('seed')!;
if (params.get('auto')) {
  const tick = setInterval(() => {
    if (!$<HTMLButtonElement>('run').disabled && $<HTMLTextAreaElement>('p1').value) { clearInterval(tick); $('run').click(); }
  }, 100);
}
