// Runs dev/battle.html in headless Chrome (the real target: wasm + @pkmn/sim
// inside a Web Worker) and prints the outcome. Needs `npm run build` first.
//   node scripts/chrome-battle.mjs [seed]
import {context} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {fileURLToPath} from 'node:url';

const web = fileURLToPath(new URL('../', import.meta.url));
const document_text = (t) => (t || '').slice(0, 160);
const ctx = await context({entryPoints: [], outdir: `${web}dist`});
const {hosts, port} = await ctx.serve({servedir: `${web}../`, port: 8976});
const base = `http://${hosts[0]}:${port}/web`;
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({executablePath, headless: true, args: ['--no-proxy-server']});
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) console.error('page:', m.text()); });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('response', (r) => { if (r.status() >= 400) console.error('http', r.status(), r.url()); });
  await page.goto(`${base}/dev/battle.html?auto=1&seed=${process.argv[2] ?? 1}`);
  await page.waitForFunction(() => window.__outcome, {timeout: 180_000});
  const o = await page.evaluate(() => window.__outcome);
  console.log(`chrome worker: winner=${o.winner} turns=${o.turns} ${o.ms} ms megas=${o.megas} fallbacks=${o.fallbacks} problems=${o.problems.length}`);
  for (const p of o.problems) console.log('  !', p);
  console.log('log lines:', o.log.length, '| first:', o.log.find((l) => l.startsWith('|turn|')));
  console.log('summary:', document_text(await page.evaluate(() => document.getElementById('summary').textContent)));
  // The hosted replay player renders asynchronously inside the srcdoc iframe.
  await page.waitForFunction(() => {
    const f = document.querySelector('iframe.replay-frame');
    const d = f && f.contentDocument;
    return !!d && d.querySelectorAll('.battle *').length > 0 && (d.querySelector('.battle-log')?.textContent ?? '').length > 0;
  }, {timeout: 60_000});
  const replay = await page.evaluate(() => {
    const f = document.querySelector('iframe.replay-frame');
    const d = f.contentDocument;
    const b = d.body, h = d.documentElement;
    return {height: f.style.height, bodyScroll: b.scrollHeight, docScroll: h.scrollHeight, battleNodes: d.querySelectorAll('.battle *').length, logChars: d.querySelector('.battle-log').textContent.length, avatarLine: window.__outcome.log.find((l) => l.startsWith('|player|p2'))};
  });
  console.log('replay:', JSON.stringify(replay));
} finally {
  await browser.close();
  await ctx.dispose();
}
