// Run one battle from the terminal with a per-decision trace.
//   npm run battle -- [p1 file] [p2 file] [seed]   (files relative to rollmons/)
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {Teams} from '@pkmn/sim';
import {runBattle} from '../battle/runner.ts';
import {loadEngine, REPO_ROOT} from './load-engine.ts';

function team(file: string) {
  const t = Teams.import(readFileSync(`${REPO_ROOT}rollmons/${file}`, 'utf8'));
  if (!t) throw new Error(`could not import ${file}`);
  return t;
}

const [p1 = 'pool/advanced/Cynthia.txt', p2 = 'bosses/leon.txt', seed = '1'] = process.argv.slice(2);
const engine = await loadEngine();
console.log(engine.engine_version());
const out = runBattle({
  engine,
  p1: {name: 'Player', team: team(p1)},
  p2: {name: 'Boss', team: team(p2)},
  seed: Number(seed),
  onTurn: (e) => {
    if (e.source === 'fallback') { mkdirSync(`${REPO_ROOT}web/dist`, {recursive: true}); writeFileSync(`${REPO_ROOT}web/dist/fallback-T${e.turn}-${e.side}.state.txt`, e.state); }
    console.log(`T${e.turn} ${e.side} ${e.choice}  (${e.iterations} it, ${e.candidates.map((c) => `${c.choice.label}:${c.visits}`).join(' ')})${e.source === 'fallback' ? '  FALLBACK' : ''}`);
  },
});
mkdirSync(`${REPO_ROOT}web/dist`, {recursive: true});
writeFileSync(`${REPO_ROOT}web/dist/last-battle.log.txt`, out.log.join('\n'));
console.log(`${p1} vs ${p2} seed=${seed}: winner=${out.winner} turns=${out.turns} ${out.ms} ms megas=${out.megas} fallbacks=${out.fallbacks}`);
for (const p of out.problems) console.log('  !', p);
if (out.problems.length) process.exitCode = 1;
