// Bundles the leaderboard function for Vercel's Build Output API into
// dist-api/api/leaderboard.func/ (index.mjs + game-data.json + .vc-config.json).
// deploy/vercel-build.sh copies it under .vercel/output/functions/.
//   node scripts/build-api.mjs        (after `npm run build`, which writes dist/data/game-data.json)
import {build} from 'esbuild';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const web = fileURLToPath(new URL('../', import.meta.url));
const out = `${web}dist-api/api/leaderboard.func`;
mkdirSync(out, {recursive: true});
await build({
  entryPoints: [`${web}api/entry.ts`],
  outfile: `${out}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  // esbuild's ESM output has no `require`; CJS dependencies (@pkmn/sim) need one.
  banner: {js: "import {createRequire as __cr} from 'node:module'; const require = __cr(import.meta.url);"},
});
copyFileSync(`${web}dist/data/game-data.json`, `${out}/game-data.json`);
writeFileSync(`${out}/.vc-config.json`, JSON.stringify({runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30}, null, 2));
console.log(`function bundle: ${out}`);
