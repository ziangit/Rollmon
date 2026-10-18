// Ported from tests/test_web_app.py (the Python reference is the spec).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accumulatePlayerDamage, damageByPlayerPokemon, damagePayload, gauntletDamageSummary, seedDamageTracking} from './summary.ts';

test('damage summary attributes player damage from replay logs', () => {
  const log = [
    '|player|p1|Player|', '|player|p2|Ash|',
    '|switch|p1a: Azu|Azumarill, L100|100/100', '|switch|p2a: Lapras|Lapras, L100|100/100',
    '|move|p1a: Azu|Play Rough|p2a: Lapras', '|-damage|p2a: Lapras|48/100',
    '|move|p2a: Lapras|Blizzard|p1a: Azu', '|-damage|p1a: Azu|60/100',
    '|move|p1a: Azu|Aqua Jet|p2a: Lapras', '|-damage|p2a: Lapras|0 fnt', '|faint|p2a: Lapras',
    '|switch|p2a: Charizard|Charizard, L100|100/100',
    '|move|p1a: Azu|Aqua Jet|p2a: Charizard', '|-damage|p2a: Charizard|82/100',
    '|win|Player',
  ];
  assert.deepEqual([...damageByPlayerPokemon(log, 'Player')], [['Azumarill', 118]]);
});

test('omniscient logs with absolute HP are measured as percent of max', () => {
  const log = [
    '|player|p1|Player||', '|player|p2|Boss||',
    '|switch|p1a: Garchomp|Garchomp, F|358/358', '|switch|p2a: Charizard|Charizard, M|297/297',
    '|move|p1a: Garchomp|Scale Shot|p2a: Charizard', '|-damage|p2a: Charizard|141/297', '|-damage|p2a: Charizard|0 fnt',
    '|-damage|p1a: Garchomp|193/358|[from] item: Life Orb',
  ];
  const [[name, dmg]] = [...damageByPlayerPokemon(log, 'Player')];
  assert.equal(name, 'Garchomp');
  assert.ok(Math.abs(dmg - 100) < 1e-9);
});

test('roster and replay names collapse to one entry', () => {
  const {totals, display} = seedDamageTracking(['scizor', 'iron moth', 'necrozma-dusk-mane']);
  const log = [
    '|player|p1|Player|', '|player|p2|Ash|',
    '|switch|p1a: Sci|Scizor, L100|100/100', '|switch|p2a: Lapras|Lapras, L100|100/100',
    '|move|p1a: Sci|U-turn|p2a: Lapras', '|-damage|p2a: Lapras|40/100',
    '|switch|p1a: Moth|Iron Moth, L100|100/100',
    '|move|p1a: Moth|Fiery Dance|p2a: Lapras', '|-damage|p2a: Lapras|0 fnt',
    '|win|Player',
  ];
  accumulatePlayerDamage(totals, display, log, 'Player');
  const payload = damagePayload(totals, display);
  assert.deepEqual(payload.byPokemon.map((e) => e.name), ['scizor', 'iron moth', 'necrozma-dusk-mane']);
  assert.equal(payload.total, 100);
  assert.equal(payload.mvp?.name, 'scizor');
  assert.equal(payload.mvp?.damage, 60);
});

test('payload reports total, mvp, contribution, and the gauntlet sentence', () => {
  const totals = new Map([['Azumarill', 75], ['Staraptor', 90], ['Breloom', 0]]);
  const payload = damagePayload(totals);
  assert.equal(payload.total, 165);
  assert.equal(payload.mvp?.name, 'Staraptor');
  assert.equal(payload.mvp?.damage, 90);
  assert.ok(Math.abs(payload.mvp!.contribution - 54.545) < 0.001);
  assert.equal(
    gauntletDamageSummary(totals),
    'Your MVP is Staraptor, dealing 90.0% damage to your opponents (54.5% contribution). Team damage: Staraptor 90.0% (54.5%), Azumarill 75.0% (45.5%), Breloom 0.0% (0.0%).',
  );
  assert.equal(gauntletDamageSummary(new Map([['x', 0]])), null);
});
