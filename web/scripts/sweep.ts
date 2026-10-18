// Many quick battles over random pairs of the repo's teams, to shake out
// mapper/driver problems (engine panics, sim rejections, fallbacks).
//   node scripts/sweep.ts [count] [budget_ms]
import {mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Teams} from '@pkmn/sim';
import {mulberry32, runBattle} from '../battle/runner.ts';
import {loadEngine, REPO_ROOT} from './load-engine.ts';

function* txtFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* txtFiles(p);
    else if (name.endsWith('.txt')) yield p;
  }
}

const count = Number(process.argv[2] ?? 20);
const budget = Number(process.argv[3] ?? 10);
const engine = await loadEngine();
const teams = [...txtFiles(`${REPO_ROOT}rollmons/bosses`), ...txtFiles(`${REPO_ROOT}rollmons/pool`)]
  .map((f) => ({file: f.replace(`${REPO_ROOT}rollmons/`, ''), team: Teams.import(readFileSync(f, 'utf8'))}))
  .filter((t): t is {file: string; team: NonNullable<typeof t.team>} => !!t.team && t.team.length === 6);
console.log(`${teams.length} six-member teams, ${count} battles at ${budget} ms/decision`);
const rng = mulberry32(42);
let bad = 0;
const wins = {p1: 0, p2: 0, none: 0};
for (let i = 0; i < count; i++) {
  const a = teams[Math.floor(rng() * teams.length)];
  const b = teams[Math.floor(rng() * teams.length)];
  const seed = i + 1;
  try {
    const o = runBattle({
      engine, p1: {name: 'A', team: a.team}, p2: {name: 'B', team: b.team}, seed, budgetMs: {p1: budget, p2: budget},
      onTurn: (e) => {
        if (e.source !== 'fallback') return;
        mkdirSync(`${REPO_ROOT}web/dist/fallbacks`, {recursive: true});
        writeFileSync(`${REPO_ROOT}web/dist/fallbacks/b${i + 1}-T${e.turn}-${e.side}.state.txt`, e.state);
      },
    });
    const key = o.winner === 'A' ? 'p1' : o.winner === 'B' ? 'p2' : 'none';
    wins[key]++;
    const flag = o.problems.length ? '  PROBLEMS' : '';
    console.log(`${String(i + 1).padStart(3)} ${a.file} vs ${b.file} seed=${seed}: ${key} in ${o.turns} turns, ${o.ms} ms, megas=${o.megas}${flag}`);
    for (const p of o.problems) { bad++; console.log(`      ! ${p.slice(0, 300)}`); }
  } catch (err) {
    bad++;
    console.log(`${String(i + 1).padStart(3)} ${a.file} vs ${b.file} seed=${seed}: CRASH ${(err as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
  }
}
console.log(`done: p1=${wins.p1} p2=${wins.p2} none=${wins.none}, problems=${bad}`);
if (bad) process.exitCode = 1;
