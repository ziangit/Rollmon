// Plays one whole run of the built game (dist/index.html) in headless Chrome:
// draft six by first pick, keep the default loadout, start the tiered
// campaign, and wait for the results screen. Needs `npm run build` first.
//   node scripts/chrome-app.mjs [seed] [p1ms] [p2ms]          (ROLLMONS_URL=https://… to check a deployed site)
import {context} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {fileURLToPath} from 'node:url';

const [seed = 7, p1ms = 10, p2ms = 10] = process.argv.slice(2);
const web = fileURLToPath(new URL('../', import.meta.url));
const ctx = await context({entryPoints: [], outdir: `${web}dist`});
const {hosts, port} = await ctx.serve({servedir: `${web}../`, port: 8977});
// ROLLMONS_URL=https://… checks a deployed site instead of the local build.
const base = (process.env.ROLLMONS_URL ?? `http://${hosts[0]}:${port}/web/dist/`).replace(/\/$/, '');
const executablePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({executablePath, headless: true, args: ['--no-proxy-server']});
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 900});
  // DOM clicks: coordinate clicks can land on the sticky top bar after a scroll.
  const click = (sel) => page.$eval(sel, (el) => el.click());
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) console.error('page:', m.text()); });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('pokemonshowdown.com')) console.error('http', r.status(), r.url()); });
  await page.goto(`${base}/index.html?seed=${seed}&p1ms=${p1ms}&p2ms=${p2ms}`);

  // boot: data loaded, matrix rendered, worker ready
  await page.waitForFunction(() => /draftable/.test(document.getElementById('matrix-summary').textContent), {timeout: 60_000});
  console.log(`[${elapsed()}] boot:`, await page.$eval('#matrix-summary', (e) => e.textContent), '| engine', await page.evaluate(() => window.__rollmons.ready));
  console.log('  matrix cells:', await page.$$eval('#matrix .mcell', (c) => c.length), '| bosses:', await page.$$eval('#ladder .boss', (b) => b.length));

  // draft: six rounds, first candidate each time
  await click('#screen-title .title-actions .btn-primary');
  for (let round = 1; round <= 6; round++) {
    await page.waitForSelector('#candidates .pick');
    const label = await page.$eval('#round-label', (e) => e.textContent);
    const cell = await page.$eval('#encounter .cell-name', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    const names = await page.$$eval('#candidates .mon-name', (ns) => ns.map((n) => n.textContent));
    console.log(`  ${label}: ${cell} -> ${names.join(', ')}`);
    await click('#candidates .pick');
    await page.waitForFunction((r) => document.querySelectorAll('#party .slot:not(.empty)').length === r, {}, round);
  }
  await page.waitForSelector('#draft-done:not(.hidden)');
  const team = await page.$$eval('#party-done .slot strong', (ns) => ns.map((n) => n.textContent));
  console.log(`[${elapsed()}] drafted:`, team.join(', '));

  // loadout: default sets, one card per Pokémon
  await click('#draft-done .btn-primary');
  await page.waitForFunction(() => window.__rollmons.screen() === 'loadout');
  const cards = await page.$$eval('#loadout-list .loadout-card', (cs) => cs.map((c) => ({name: c.querySelector('strong').textContent, options: c.querySelectorAll('option').length})));
  console.log('  loadout:', cards.map((c) => `${c.name} (${c.options || 1})`).join(', '));
  await click('#screen-loadout .section-head .btn-primary');
  await page.waitForFunction(() => window.__rollmons.screen() === 'bosses');

  // campaign: ten tiered battles in the worker (stops on the first loss)
  await click('#campaign-btn');
  await page.waitForFunction(() => window.__rollmons.screen() === 'battle');
  let last = '';
  const poll = setInterval(async () => {
    try {
      const rail = await page.$$eval('#rail li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
      if (rail !== last) { last = rail; console.log(`  [${elapsed()}] ${rail}`); }
    } catch { /* page navigating */ }
  }, 1500);
  // the run is over when the summary button unlocks; the page only auto-navigates once no live replay is still playing
  await page.waitForFunction(() => !document.getElementById('to-results').disabled, {timeout: 600_000});
  clearInterval(poll);
  const autoNavigated = await page.evaluate(() => new Promise((r) => setTimeout(() => r(window.__rollmons.screen() === 'results'), 800)));
  console.log(`[${elapsed()}] run over; auto-navigated to results: ${autoNavigated} (false while a live replay is still animating)`);
  if (!autoNavigated) await click('#to-results');
  await page.waitForFunction(() => window.__rollmons.screen() === 'results');
  const view = await page.evaluate(() => { const v = window.__rollmons.view(); return {summary: v.gauntlet.summary, results: v.gauntlet.results.map((r) => [r.bossName, r.winner, r.turns, r.megas, r.problems.length])}; });
  console.log(`[${elapsed()}] results:`, await page.$eval('#result-title', (e) => e.textContent), '|', await page.$eval('#result-record', (e) => e.textContent));
  for (const r of view.results) console.log('  ', r.join(' '));
  console.log('  summary:', view.summary);
  console.log('  damage rows:', await page.$$eval('#damage-bars .dmg-row', (r) => r.length), '| ladder rows:', await page.$$eval('#ladder-results .ladder-row', (r) => r.length), '| mvp:', await page.$eval('#mvp-card', (e) => e.classList.contains('hidden') ? 'none' : e.querySelector('strong').textContent));

  // rewatch: the replay player paints inside the first theater card
  await click('#screen-results .result-actions .btn-ghost');
  await page.waitForFunction(() => {
    const f = document.querySelector('#theater iframe.replay-frame');
    const d = f && f.contentDocument;
    return !!d && d.querySelectorAll('.battle *').length > 0 && (d.querySelector('.battle-log')?.textContent ?? '').length > 0;
  }, {timeout: 60_000});
  const replay = await page.evaluate(() => {
    const d = document.querySelector('#theater iframe.replay-frame').contentDocument;
    const log = d.querySelector('.battle-log');
    return {infobox: !!log.querySelector('.infobox'), literalMarkup: /<div class/.test(log.textContent), controls: d.querySelectorAll('.replay-controls button').length};
  });
  console.log(`[${elapsed()}] replay cards:`, await page.$$eval('#theater .replay-card', (c) => c.length), '| first frame painted |', JSON.stringify(replay));
  if (!replay.infobox || replay.literalMarkup) { console.error('replay rendered |raw| html as text'); process.exitCode = 1; }
  // every card was mounted live and fed the whole battle as it was played
  const live = await page.$$eval('#theater .replay-card', (cs) => cs.map((c) => {
    const b = c.querySelector('iframe.replay-frame')?.contentWindow?.rollmonsLive?.battle;
    return {live: c.dataset.live === '1', lines: Number(c.dataset.lines || 0), chip: c.querySelector('.res')?.className, playing: !!b && !b.ended};
  }));
  console.log('  live cards:', live.map((l) => `${l.lines} lines/${l.chip?.replace('res ', '')}${l.playing ? ' (still animating)' : ''}`).join(', '));
  // a chip may still read "Live" only while its player is still animating the battle
  if (!live.length || live.some((l) => !l.live || l.lines < 20 || (l.chip?.includes('live') && !l.playing))) { console.error('live replay cards missing, unfed, or never resolved'); process.exitCode = 1; }
  const firstQueue = await page.evaluate(() => { const w = document.querySelector('#theater iframe.replay-frame').contentWindow; return w.rollmonsLive ? {queued: w.rollmonsLive.battle.stepQueue.length, ended: w.rollmonsLive.battle.ended} : null; });
  console.log('  first player:', JSON.stringify(firstQueue));
  if (!firstQueue || firstQueue.queued < 20) { console.error('the live player did not receive the streamed lines'); process.exitCode = 1; }
  // rail entries of finished battles jump to their replay card
  await click('#rail li.clickable');
  await page.waitForFunction(() => window.__rollmons.screen() === 'battle');
  console.log('  rail click ->', await page.$$eval('#rail li.clickable', (l) => l.length), 'clickable entries');
  if (view.results.some((r) => r[4] > 0)) { console.error('battle problems reported'); process.exitCode = 1; }
} finally {
  await browser.close();
  await ctx.dispose();
}
