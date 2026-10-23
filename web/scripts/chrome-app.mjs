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
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('pokemonshowdown.com') && !r.url().includes('/api/')) console.error('http', r.status(), r.url()); });
  await page.goto(`${base}/index.html?seed=${seed}&p1ms=${p1ms}&p2ms=${p2ms}`);

  // boot: data loaded, matrix rendered, worker ready
  await page.waitForFunction(() => /draftable/.test(document.getElementById('pool-summary').textContent), {timeout: 60_000});
  console.log(`[${elapsed()}] boot:`, await page.$eval('#pool-summary', (e) => e.textContent), '| engine', await page.evaluate(() => window.__rollmons.ready));
  // the pool is the Type × Gen matrix; a cell click lists that cell's natives in the panel
  const matrixCells = await page.$$eval('#pool-matrix .mcell:not(.none)', (c) => c.length);
  await page.evaluate(() => window.poolCell('fire', 4));
  console.log('  pool matrix cells:', matrixCells, '| fire/gen4 natives:', await page.$$eval('#pool-detail .pmon', (c) => c.length), '| bosses:', await page.$$eval('#ladder .boss', (b) => b.length));

  // title screen: the tools strip (leaderboard · language · account) sits in the fixed corner;
  // the board opens as a drawer. A local build reads the board cross-origin and has no accounts.
  const hosted = /^https:/.test(base);
  await page.waitForFunction(() => document.getElementById('board-btn').dataset.state !== 'loading', {timeout: 20_000}).catch(() => {});
  const tools = await page.evaluate(() => ({corner: !!document.querySelector('#corner #tools'), board: document.getElementById('board-btn').dataset.state === 'ready', signin: !!document.getElementById('signin-btn'), feedback: !!document.getElementById('feedback-btn')}));
  if (tools.board) {
    await click('#board-btn');
    await page.waitForFunction(() => !document.getElementById('board-drawer').classList.contains('hidden') && document.querySelector('#board-card .board-list li'));
    tools.rows = await page.$$eval('#board-card .board-list li', (r) => r.length);
    await click('#board-backdrop');
  }
  // feedback: the button in the strip; the pool's "Contribute a set" opens the drawer for that species
  const contribute = await page.$$eval('#pool-detail .contribute', (b) => b.length);
  await page.evaluate(() => window.openFeedback('set', 'lucario'));
  const drawer = await page.evaluate(() => ({open: !document.getElementById('feedback-drawer').classList.contains('hidden'), title: document.getElementById('feedback-title').textContent}));
  await page.evaluate(() => window.closeFeedback());
  console.log(`[${elapsed()}] title tools:`, JSON.stringify(tools), '| contribute buttons:', contribute, '| drawer:', JSON.stringify(drawer));
  if (!tools.feedback || !contribute || !drawer.open || !/Lucario/.test(drawer.title)) { console.error('feedback button, contribute button, or drawer missing'); process.exitCode = 1; }
  if (!tools.corner || tools.signin !== hosted) { console.error('tools strip not in the corner, or the account button does not match the deployment'); process.exitCode = 1; }

  // draft: six rounds; the first tile is highlighted, its second set (when there is one) is opened so the proof carries a set choice
  await click('#screen-title .title-actions .btn-primary');
  for (let round = 1; round <= 6; round++) {
    await page.waitForSelector('#cand-detail .pick');
    const label = await page.$eval('#encounter .eyebrow', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    const cell = await page.$eval('#encounter .cell-name', (e) => e.textContent.replace(/\s+/g, ' ').trim());
    const names = await page.$$eval('#candidates .cand-name', (ns) => ns.map((n) => n.textContent));
    const rarities = await page.$$eval('#candidates .cand .stars', (ns) => ns.map((n) => n.textContent));
    if (rarities.length !== names.length) throw new Error(`round ${round}: ${names.length} candidates but ${rarities.length} rarity rows`);
    const visitors = await page.$$eval('#candidates .cand.visitor', (ns) => ns.length);
    const tabs = await page.evaluate(() => { const tabs = document.querySelectorAll('#cand-detail .stab'); if (tabs.length > 1) tabs[1].click(); return tabs.length; });
    // the panel rises in after the tiles; it must end fully visible with the open set's moves
    await page.waitForFunction(() => { const e = document.getElementById('cand-detail'); return getComputedStyle(e).opacity === '1' && e.querySelectorAll('.pmove').length > 0; }, {timeout: 3000})
      .catch(() => { throw new Error(`round ${round}: set panel not visible after the transition`); });
    console.log(`  ${label}: ${cell} -> ${names.map((n, i) => `${n} ${rarities[i]}`).join(', ')}${visitors ? ` (${visitors} visitor${visitors > 1 ? 's' : ''})` : ''} | ${tabs} sets`);
    await click('#cand-detail .pick');
    await page.waitForFunction((r) => document.querySelectorAll('#party .pslot.filled').length === r, {}, round);
  }
  await page.waitForSelector('#draft-done:not(.hidden)');
  const team = await page.$$eval('#party-done .slot strong', (ns) => ns.map((n) => n.textContent));
  console.log(`[${elapsed()}] drafted:`, team.join(', '));

  // loadout: default sets, one card per Pokémon
  await click('#draft-done .btn-primary');
  await page.waitForFunction(() => window.__rollmons.screen() === 'loadout');
  const cards = await page.$$eval('#loadout-list .loadout-card', (cs) => cs.map((c) => ({name: c.querySelector('strong').textContent, options: c.querySelectorAll('option').length})));
  console.log('  loadout:', cards.map((c) => `${c.name} (${c.options || 1})`).join(', '));
  // the Gauntlet step is gone for players; the developer page opens only locally or for the author's account
  const steps = await page.$$eval('#steps .step', (ss) => ss.map((s) => s.dataset.step));
  if (steps.includes('bosses')) throw new Error(`gauntlet step shown to players: ${steps}`);
  const devBtn = await page.$eval('#dev-btn', (b) => !b.classList.contains('hidden'));
  if (devBtn === hosted) throw new Error(`developer button ${devBtn ? "shown" : "hidden"} (hosted: ${hosted})`);
  // campaign: the loadout button starts the ten tiered battles in the worker (stops on the first loss)
  await click('#screen-loadout .section-head .btn-primary');
  await page.waitForFunction(() => window.__rollmons.screen() === 'battle');
  // Spoiler gate: after the engine has finished battle 1, nothing about it (or
  // about later bosses) is shown until its replay has been watched to the end.
  await page.waitForFunction(() => window.__rollmons.view()?.gauntlet.results.length >= 1, {timeout: 120_000});
  await new Promise((r) => setTimeout(r, 1500));
  const gate = await page.evaluate(() => ({
    cards: document.querySelectorAll('#theater .replay-card').length,
    decided: document.querySelectorAll('#rail li.win, #rail li.loss, #rail li.tie').length,
    hidden: Array.from(document.querySelectorAll('#rail li')).filter((l) => l.textContent.includes('???')).length,
    summary: document.getElementById('to-results').disabled && document.getElementById('summary-fab').classList.contains('hidden'),
    lead: document.getElementById('battle-lead').textContent,
  }));
  console.log(`[${elapsed()}] gate while battle 1 plays:`, JSON.stringify(gate));
  if (gate.cards !== 1 || gate.decided !== 0 || gate.hidden < 8 || !gate.summary) { console.error('spoiler gate failed: next battle, results, or boss names shown before the replay ended'); process.exitCode = 1; }
  // Watch each battle by seeking its player to the end as soon as the engine has finished it.
  let last = '';
  const poll = setInterval(async () => {
    try {
      const rail = await page.$$eval('#rail li', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
      if (rail !== last) { last = rail; console.log(`  [${elapsed()}] ${rail}`); }
      await page.evaluate(() => {
        const done = window.__rollmons.view()?.gauntlet.results.length ?? 0;
        document.querySelectorAll('#theater iframe.replay-frame').forEach((f, i) => { const b = f.contentWindow?.rollmonsLive?.battle; if (i < done && b && !b.ended) b.seekTurn(Infinity); });
      });
    } catch { /* page navigating */ }
  }, 1500);
  // the run is over when the summary button unlocks (after the last battle has been watched); the page never auto-navigates
  await page.waitForFunction(() => !document.getElementById('to-results').disabled, {timeout: 600_000});
  clearInterval(poll);
  const fab = await page.evaluate(() => ({shown: !document.getElementById('summary-fab').classList.contains('hidden'), screen: window.__rollmons.screen(), lead: document.getElementById('battle-lead').textContent}));
  console.log(`[${elapsed()}] run over:`, JSON.stringify(fab));
  if (!fab.shown || fab.screen !== 'battle') { console.error('summary button not shown on the battle screen after the run'); process.exitCode = 1; }
  await click('#summary-fab');
  await page.waitForFunction(() => window.__rollmons.screen() === 'results');
  const view = await page.evaluate(() => { const v = window.__rollmons.view(); return {summary: v.gauntlet.summary, score: v.gauntlet.score?.total, results: v.gauntlet.results.map((r) => [r.bossName, r.winner, r.turns, r.megas, r.problems.length])}; });
  console.log(`[${elapsed()}] results:`, await page.$eval('#result-title', (e) => e.textContent), '|', await page.$eval('#result-record', (e) => e.textContent));
  for (const r of view.results) console.log('  ', r.join(' '));
  console.log('  summary:', view.summary);
  const score = await page.evaluate(() => ({total: Number(document.getElementById('score-total')?.textContent), signin: !!document.getElementById('score-signin'), status: document.querySelector('#score-card .score-status')?.textContent ?? ''}));
  console.log('  score:', JSON.stringify(score), '| view score:', view.score, '| topbar tools:', await page.evaluate(() => !!document.querySelector('#topbar #tools')));
  if (!(score.total >= 0) || score.total !== view.score || score.signin !== hosted) { console.error('score card missing, does not match the session score, or lacks the sign-in button'); process.exitCode = 1; }
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
