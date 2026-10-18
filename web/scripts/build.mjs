// Builds the static site into dist/: the game page (app/), the battle worker,
// the engine wasm, the data bundle (pokedex, moves, sets, overrides, pool,
// bosses), and the worker dev page.
//   node scripts/build.mjs [--serve]
import {build, context} from 'esbuild';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadGameData} from './game-data.ts';

const web = fileURLToPath(new URL('../', import.meta.url));
const repo = `${web}../`;
mkdirSync(`${web}dist/data`, {recursive: true});
copyFileSync(`${repo}engine/pkg/rollmons_engine_bg.wasm`, `${web}dist/rollmons_engine_bg.wasm`);
copyFileSync(`${web}app/index.html`, `${web}dist/index.html`);
copyFileSync(`${web}app/styles.css`, `${web}dist/styles.css`);
writeFileSync(`${web}dist/data/game-data.json`, JSON.stringify(loadGameData(repo)));

const options = {
  entryPoints: {app: `${web}app/main.ts`, worker: `${web}battle/worker.ts`, 'battle-page': `${web}dev/battle-page.ts`},
  outdir: `${web}dist`,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: process.argv.includes('--minify'),
  sourcemap: !process.argv.includes('--minify'),
  logLevel: 'info',
};

if (process.argv.includes('--serve')) {
  const ctx = await context(options);
  await ctx.watch();
  const {hosts, port} = await ctx.serve({servedir: web, port: 8975});
  console.log(`game: http://${hosts[0]}:${port}/dist/index.html\nworker dev page: http://${hosts[0]}:${port}/dev/battle.html`);
} else {
  await build(options);
}
