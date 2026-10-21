// GameSession: the in-page replacement for the v1 FastAPI session. Mirrors the
// route-level expectations in tests/test_web_app.py that do not need a server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BossBook, GameSession, SessionError, createGameContext, matrixView, speciesView, type BattleSpec} from './session.ts';
import {showdownSpriteId} from './sprites.ts';
import {NoSkipsRemainingError} from '../game/draft.ts';
import {loadGameData} from '../scripts/game-data.ts';

const ctx = createGameContext(loadGameData());

function draftBySuggestion(session: GameSession): void {
  while (!session.draft.complete) session.pick(session.draft.currentOffer!.suggestedSpecies);
}

/** A tiny omniscient log: the player's lead hits the boss's lead once, then the given side wins. */
function fakeLog(spec: BattleSpec, winner: 'player' | 'boss' | 'tie', playerLead: string, damageTo = 40): string[] {
  const lines = [
    '|player|p1|Player|1', `|player|p2|${spec.bossName}|2`,
    `|switch|p1a: ${playerLead}|${playerLead}, L100|100/100`, '|switch|p2a: Foe|Foe, L100|100/100', '|turn|1',
    `|move|p1a: ${playerLead}|Tackle|p2a: Foe`, `|-damage|p2a: Foe|${100 - damageTo}/100`,
  ];
  lines.push(winner === 'tie' ? '|tie' : `|win|${winner === 'player' ? 'Player' : spec.bossName}`);
  return lines;
}
const outcomeFor = (spec: BattleSpec, winner: 'player' | 'boss' | 'tie', lead: string, turns = 7) =>
  ({winner: winner === 'player' ? 'Player' : winner === 'boss' ? spec.bossName : '', turns, log: fakeLog(spec, winner, lead)});

test('species and matrix views carry sprite urls, sets, and cell states', () => {
  const clefable = speciesView(ctx, 'clefable');
  assert.equal(clefable.spriteUrl, 'https://play.pokemonshowdown.com/sprites/home-centered/clefable.png');
  assert.deepEqual(clefable.types, ['fairy']);
  assert.equal(clefable.set.source, 'override'); // rollmons/sets/clefable.txt
  assert.ok(clefable.set.export!.includes('Level: 100'));
  const raichu = speciesView(ctx, 'raichualola');
  assert.equal(showdownSpriteId(ctx.legality.species.raichualola, ctx.data.pokedex.raichualola), 'raichu-alola');
  assert.equal(raichu.set.source, 'smogon');
  assert.equal(speciesView(ctx, 'clefable'), clefable, 'views are memoised per context');

  const m = matrixView(ctx);
  assert.equal(m.cells.length, 18 * 9);
  assert.equal(m.atomCount, ctx.legality.atoms.length);
  assert.equal(m.includedCellCount, ctx.legality.matrix.size);
  assert.ok(m.cells.some((c) => c.state === 'excluded') && m.cells.some((c) => c.state === 'normal'));
  const fairy1 = m.cells.find((c) => c.type === 'fairy' && c.generation === 1)!;
  assert.ok(fairy1.pokemon.some((p) => p.id === 'clefable'));
  assert.equal(fairy1.eligibleCount, fairy1.pokemon.length);
});

test('a seeded run drafts six, builds a non-Mega default loadout, and is reproducible', () => {
  const a = new GameSession(ctx, {seed: 42});
  const b = new GameSession(ctx, {seed: 42});
  const first = a.view();
  assert.equal(first.roundNumber, 1);
  assert.ok(first.offer!.candidates.every((c) => c.rarityName === ['common', 'uncommon', 'rare', 'legendary'][c.rarity]));
  assert.deepEqual(first.offer!.rarityOdds, [50, 28, 12, 10]);
  assert.equal(first.teamExport, null);
  assert.equal(first.loadout, null);
  draftBySuggestion(a); draftBySuggestion(b);
  assert.deepEqual(a.draft.picks, b.draft.picks);
  const v = a.view();
  assert.ok(v.complete);
  assert.equal(v.team.length, 6);
  assert.equal(v.loadout!.length, 6);
  assert.ok(v.loadout!.every((e) => e.sets.some((s) => s.setId === e.chosenSetId) && !e.locked));
  assert.ok(v.loadout!.every((e) => !e.sets.find((s) => s.setId === e.chosenSetId)!.isMega), 'Mega is opt-in');
  assert.equal(v.teamExport!.split('\n\n').length, 6);
  assert.equal(v.teamExport, b.view().teamExport);
});

test('loadout choices rebuild the export and lock once battles start', () => {
  const s = new GameSession(ctx, {seed: 7});
  draftBySuggestion(s);
  const entry = s.view().loadout!.find((e) => e.sets.length > 1)!;
  const other = entry.sets.find((o) => o.setId !== entry.chosenSetId)!;
  s.chooseSet(entry.speciesId, other.setId);
  const v = s.view();
  assert.equal(v.loadout!.find((e) => e.speciesId === entry.speciesId)!.chosenSetId, other.setId);
  assert.ok(v.teamExport!.includes(other.export));
  assert.throws(() => s.chooseSet(entry.speciesId, 'bogus:9'), /unknown set/);
  assert.throws(() => s.chooseSet('notonteam', other.setId), /not on the drafted team/);
  s.startCampaign(true);
  assert.throws(() => s.chooseSet(entry.speciesId, entry.chosenSetId), /locked/);
  assert.ok(s.view().loadout!.every((e) => e.locked));
});

test('draft actions surface draft errors and skips are bounded', () => {
  const s = new GameSession(ctx, {seed: 3});
  s.skip(); s.skip();
  assert.throws(() => s.skip(), NoSkipsRemainingError);
  assert.throws(() => s.startCampaign(true), /draft is not complete/);
  assert.throws(() => s.nextBattleSpec(), /gauntlet has not started/);
});

test('the campaign runs ten tiered battles, folds damage, and summarises', () => {
  const s = new GameSession(ctx, {seed: 11});
  draftBySuggestion(s);
  s.startCampaign(false);
  let g = s.gauntletView();
  assert.equal(g.bosses.length, 10);
  assert.ok(g.bosses[0].current && !g.complete);
  const lead = s.view().team[0].name;
  let n = 0;
  for (;;) {
    const spec = s.nextBattleSpec();
    if (!spec) break;
    assert.equal(spec.bossId, g.bosses[n].id);
    assert.equal(spec.bossName, spec.bossId, 'campaign bosses are named after their pool file');
    assert.equal(spec.playerTeam, s.view().teamExport);
    const result = s.recordGauntletBattle(spec, outcomeFor(spec, n % 3 === 2 ? 'boss' : 'player', lead, 5 + n));
    assert.equal(result.winner, n % 3 === 2 ? 'boss' : 'player');
    assert.equal(result.battleId, spec.battleId, 'the id is minted with the spec so the live card can be built first');
    n++;
    g = s.gauntletView();
    assert.equal(g.nextIndex, n);
  }
  assert.equal(n, 10);
  assert.ok(g.complete);
  assert.equal(g.results.length, 10);
  assert.equal(g.results[9].bossName, g.bosses[9].name);
  assert.match(g.summary!, /^Your record is 7-3! Average turn is 9\.5\. Your MVP is /);
  assert.equal(g.damage.mvp!.damage, 400);
  assert.equal(g.damage.byPokemon.length, 6, 'the whole roster is listed even at zero damage');
  assert.equal(new Set(g.results.map((r) => r.battleId)).size, 10);
  assert.equal(s.view().battleResult, g.results[9]);
});

test('stop-on-loss ends the gauntlet early and a manual ladder uses the boss book', () => {
  const s = new GameSession(ctx, {seed: 5});
  draftBySuggestion(s);
  const ids = s.bosses.list().map((b) => b.id);
  assert.equal(ids[0], 'ash');
  assert.throws(() => s.startGauntlet([], true), /no boss teams/);
  assert.throws(() => s.startGauntlet(Array(11).fill('ash'), true), /at most 10/);
  s.startGauntlet(['leon', 'ash'], true);
  const spec = s.nextBattleSpec()!;
  assert.equal(spec.bossName, 'Leon');
  assert.ok(spec.bossTeam.includes('Charizard'));
  const r = s.recordGauntletBattle(spec, outcomeFor(spec, 'tie', s.view().team[0].name));
  assert.equal(r.winner, 'tie');
  const g = s.gauntletView();
  assert.ok(g.complete && g.stopOnLoss);
  assert.equal(g.results.length, 1);
  assert.equal(s.nextBattleSpec(), null);
  assert.match(g.summary!, /^Your record is 0-0-1!/);
  assert.throws(() => s.recordGauntletBattle(spec, outcomeFor(spec, 'player', 'x')), /does not match/);
});

test('a single exhibition battle records a result outside the gauntlet', () => {
  const s = new GameSession(ctx, {seed: 9});
  draftBySuggestion(s);
  const spec = s.singleBattleSpec('ash');
  assert.equal(spec.bossName, 'Ash');
  s.recordSingleBattle(spec, outcomeFor(spec, 'boss', s.view().team[0].name, 12));
  const v = s.view();
  assert.equal(v.battleResult!.winner, 'boss');
  assert.equal(v.battleResult!.turns, 12);
  assert.deepEqual(v.gauntlet.bosses, []);
  assert.ok(v.loadout!.every((e) => e.locked));
});

test('the boss book validates pasted and edited bosses', () => {
  const book = new BossBook(ctx);
  const files = book.list();
  assert.ok(files.every((b) => b.source === 'file'));
  assert.throws(() => book.addCustom('Misty', 'Starmie @ Leftovers\nAbility: Natural Cure\n- Surf'), (e: Error) => e instanceof SessionError && /exactly 6/.test(e.message));
  assert.throws(() => book.addCustom('Misty', book.team('ash').replace('Volt Tackle', 'Volt Tackle Zap')), /volttacklezap/);
  assert.throws(() => book.addCustom('', book.team('ash')), /1–80/);
  const custom = book.addCustom(' Misty ', book.team('ash'));
  assert.deepEqual(custom, {id: 'custom-1', name: 'Misty', source: 'custom'});
  assert.equal(book.name('custom-1'), 'Misty');
  assert.equal(book.list().at(-1)!.id, 'custom-1');
  const edited = book.edit('ash', 'Ash Ketchum', book.team('leon'));
  assert.deepEqual(edited, {id: 'ash', name: 'Ash Ketchum', source: 'edited'});
  assert.equal(book.info('ash').source, 'edited');
  assert.ok(book.team('ash').includes('Charizard'));
  assert.throws(() => book.edit('nobody', 'X', book.team('leon')), /unknown boss/);

  const s = new GameSession(ctx, {seed: 1, bosses: book});
  draftBySuggestion(s);
  s.startGauntlet(['custom-1', 'ash'], false);
  assert.deepEqual(s.gauntletView().bosses.map((b) => b.name), ['Misty', 'Ash Ketchum']);
});
