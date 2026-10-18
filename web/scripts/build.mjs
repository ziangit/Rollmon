// Bundles the battle worker and copies the wasm next to it.
//   node scripts/build.mjs [--serve]
import {build, context} from 'esbuild';
import {copyFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const web = fileURLToPath(new URL('../', import.meta.url));
const repo = `${web}../`;
mkdirSync(`${web}dist`, {recursive: true});
copyFileSync(`${repo}engine/pkg/rollmons_engine_bg.wasm`, `${web}dist/rollmons_engine_bg.wasm`);

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
