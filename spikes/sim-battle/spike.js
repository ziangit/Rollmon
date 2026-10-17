// Referee spike: two random-move players through @pkmn/sim under the rollmons
// custom format, teams read from the repo's own export files. Prints time,
// turns, winner, and whether a Mega Evolution happened. First run on
// 2026-10-17: Cynthia vs Leon 28 ms / 25 turns / megas=1.
//
//   cd spikes/sim-battle && npm install && npm start
const {BattleStreams, Teams, RandomPlayerAI} = require('@pkmn/sim');
const fs = require('fs');
const path = require('path');

// v1 also listed "Z-Move Clause" and "CFZ Clause"; @pkmn/sim 0.10.11 has
// neither rule and gen9 has no Z-moves, so they are dropped here.
const RULES = [
  'Species Clause', '+Past', 'Dynamax Clause', 'Terastal Clause',
  '!! Max Move Count = 4', 'Adjust Level = 100',
];
const FORMAT = 'gen9customgame@@@' + RULES.join(',');
const ROOT = path.resolve(__dirname, '..', '..', 'rollmons');

function packed(file) {
  const team = Teams.import(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  if (!team) throw new Error('could not import ' + file);
  return Teams.pack(team);
}

async function run(label, p1file, p2file) {
  const streams = BattleStreams.getPlayerStreams(new BattleStreams.BattleStream());
  const p1 = new RandomPlayerAI(streams.p1, {mega: 1.0});
  const p2 = new RandomPlayerAI(streams.p2, {mega: 1.0});
  void p1.start();
  void p2.start();
  const log = [];
  const t0 = Date.now();
  const drained = (async () => {
    for await (const chunk of streams.omniscient) log.push(...chunk.split('\n'));
  })();
  await streams.omniscient.write(
    `>start ${JSON.stringify({formatid: FORMAT})}\n` +
    `>player p1 ${JSON.stringify({name: 'Player', team: packed(p1file)})}\n` +
    `>player p2 ${JSON.stringify({name: 'Boss', team: packed(p2file)})}`,
  );
  await drained;
  const turns = log.filter(l => l.startsWith('|turn|')).length;
  const win = log.find(l => l.startsWith('|win|')) || '(no winner)';
  const megas = log.filter(l => l.startsWith('|-mega|')).length;
  const errors = log.filter(l => l.startsWith('|error|')).slice(0, 3);
  console.log(`${label}: ${Date.now() - t0} ms, turns=${turns}, ${win}, megas=${megas}, errors=${JSON.stringify(errors)}`);
}

(async () => {
  await run('Cynthia vs Leon', 'pool/advanced/Cynthia.txt', 'pool/advanced/Leon.txt');
  await run('Charizard Mega set vs Leon', 'sets/charizard.txt', 'pool/advanced/Leon.txt');
})().catch(err => { console.error('FAILED', err); process.exit(1); });
