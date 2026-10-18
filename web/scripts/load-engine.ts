// Node-side loader for the wasm-pack `--target web` build (browsers use init()).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function loadEngine() {
  const engine = await import(`${REPO_ROOT}engine/pkg/rollmons_engine.js`);
  engine.initSync({module: readFileSync(`${REPO_ROOT}engine/pkg/rollmons_engine_bg.wasm`)});
  return engine;
}
