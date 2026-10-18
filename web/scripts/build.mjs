// Bundles the battle worker, copies the wasm next to it, and emits the pure
// layer's data bundle (pokedex, moves, sets, overrides, pool, bosses) as JSON.
//   node scripts/build.mjs [--serve]
import {build, context} from 'esbuild';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadGameData} from './game-data.ts';

const web = fileURLToPath(new URL('../', import.meta.url));
const repo = `${web}../`;
mkdirSync(`${web}dist/data`, {recursive: true});
copyFileSync(`${repo}engine/pkg/rollmons_engine_bg.wasm`, `${web}dist/rollmons_engine_bg.wasm`);
writeFileSync(`${web}dist/data/game-data.json`, JSON.stringify(loadGameData(repo)));

const options = {
  entryPoints: [`${web}battle/worker.ts`, `${web}dev/battle-page.ts`],
  outdir: `${web}dist`,
  entryNames: '[name]',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};

if (process.argv.includes('--serve')) {
  const ctx = await context(options);
  await ctx.watch();
  const {hosts, port} = await ctx.serve({servedir: web, port: 8975});
  console.log(`dev page: http://${hosts[0]}:${port}/dev/battle.html`);
} else {
  await build(options);
}
