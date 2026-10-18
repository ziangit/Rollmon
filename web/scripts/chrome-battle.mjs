// Runs dev/battle.html in headless Chrome (the real target: wasm + @pkmn/sim
// inside a Web Worker) and prints the outcome. Needs `npm run build` first.
//   node scripts/chrome-battle.mjs [seed]
import {context} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {fileURLToPath} from 'node:url';

const web = fileURLToPath(new URL('../', import.meta.url));
const ctx = await context({entryPoints: [], outdir: `${web}dist`});
const {hosts, port} = await ctx.serve({servedir: `${web}../`, port: 8976});
const base = `http://${hosts[0]}:${port}/web`;
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({executablePath, headless: true, args: ['--no-proxy-server']});
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) console.error('page:', m.text()); });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(`${base}/dev/battle.html?auto=1&seed=${process.argv[2] ?? 1}`);
  await page.waitForFunction(() => window.__outcome, {timeout: 180_000});
  const o = await page.evaluate(() => window.__outcome);
  console.log(`chrome worker: winner=${o.winner} turns=${o.turns} ${o.ms} ms megas=${o.megas} fallbacks=${o.fallbacks} problems=${o.problems.length}`);
  for (const p of o.problems) console.log('  !', p);
  console.log('log lines:', o.log.length, '| first:', o.log.find((l) => l.startsWith('|turn|')));
} finally {
  await browser.close();
  await ctx.dispose();
}
