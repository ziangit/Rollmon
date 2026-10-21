// Ported from tests/test_team_assembly.py and tests/test_smogon_sets.py.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_LEVEL, NEUTRAL_EVS, STATS, TeamAssemblyError, assembleLoadout, assembleTeam, loadRandomBattleSets, loadSetOverride,
  normalizeOverrideExport, representativeRandomBattleSet, selectRandomBattleSet, selectSmogonSet, selectableSets,
} from './team-assembly.ts';
import {ingestSmogonSets, isFormatExcluded, loadUsableSmogonSets, stripTeraTypeLines} from './smogon-sets.ts';
import {seededRng, type WeightedRng} from './rng.ts';
import {loadGameData} from '../scripts/game-data.ts';

const data = loadGameData();
const DRAFTED = ['charizard', 'clefable', 'raichualola', 'ironvaliant', 'articunogalar', 'taurospaldeacombat'];

class RecordingRng implements WeightedRng {
  weights: readonly number[] | null = null;
  weightedChoice<T>(population: readonly T[], weights: readonly number[]): T { this.weights = [...weights]; return population[0]; }
}

test('randbats set selection uses observed counts as weights', () => {
  const sets = loadRandomBattleSets(data.randbats);
  const rng = new RecordingRng();
  const chosen = selectRandomBattleSet('charizard', sets, rng);
  assert.deepEqual(rng.weights, Object.values(data.randbats.charizard));
  assert.equal(chosen.observedCount, rng.weights![0]);
});

test('a source-defined single-move set is preserved', () => {
  assert.deepEqual(loadRandomBattleSets(data.randbats).ditto[0].moves, ['transform']);
});

test('the representative set is the most frequently observed role', () => {
  const sets = loadRandomBattleSets(data.randbats);
  assert.equal(representativeRandomBattleSet('charizard', sets).observedCount, Math.max(...sets.charizard.map((s) => s.observedCount)));
});

test('the team export is well formed and fixed at level 100', () => {
  const members = assembleTeam(DRAFTED, data, seededRng(1234)).split('\n\n');
  assert.equal(members.length, 6);
  for (const member of members) {
    const lines = member.split('\n');
    assert.ok(lines[0].includes(' @ '));
    assert.ok(lines.some((l) => l.startsWith('Ability: ')));
    assert.ok(lines.includes(`Level: ${FIXED_LEVEL}`));
    assert.equal(lines.filter((l) => l.startsWith('- ')).length, 4);
    assert.ok(!lines.some((l) => l.startsWith('Tera Type: ')));
  }
});

test('smogon set selection is uniform and seedable', () => {
  const sets = loadUsableSmogonSets(data.smogon, data);
  const rng = new RecordingRng();
  const chosen = selectSmogonSet('clefable', sets, rng);
  assert.ok(sets.clefable.length > 1);
  assert.deepEqual(rng.weights, [1, 1, 1]);
  assert.equal(chosen, sets.clefable[0]);
  assert.ok(!chosen.export.includes('Tera Type:'));
});

test('the neutral spread is the legal 510 EV cap', () => {
  const exportText = assembleTeam(DRAFTED, {...data, overrides: {}, source: 'randbats'}, seededRng(8));
  const evLine = exportText.split('\n\n')[0].split('\n')[3];
  const values = evLine.slice('EVs: '.length).split('/').map((p) => Number(p.trim().split(' ')[0]));
  assert.equal(values.length, STATS.length);
  assert.deepEqual(values, Array(6).fill(NEUTRAL_EVS));
  assert.equal(values.reduce((a, b) => a + b, 0), 510);
});

test('the fixed level replaces the randbats scaled level', () => {
  assert.equal(Object.keys(data.randbats.charizard)[0].split(',')[0], '85');
  const exportText = assembleTeam(DRAFTED, {...data, overrides: {}, source: 'randbats'}, new RecordingRng());
  assert.ok(!exportText.includes('Level: 85'));
  assert.equal(exportText.split('Level: 100').length - 1, 6);
});

test('team assembly rejects the wrong size and duplicates', () => {
  assert.throws(() => assembleTeam(DRAFTED.slice(0, 5), data), /exactly 6/);
  assert.throws(() => assembleTeam(Array(6).fill('charizard'), data), /Species Clause/);
});

const OVERRIDE = `Charizard @ Choice Specs
Ability: Blaze
Level: 100
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Flamethrower
- Air Slash
- Dragon Pulse
- Focus Blast
`;

test('a species override replaces the randbats set', () => {
  const overrides = {charizard: OVERRIDE};
  const exportText = assembleTeam(DRAFTED, {...data, overrides, source: 'randbats'}, new RecordingRng());
  assert.equal(loadSetOverride('charizard', overrides), OVERRIDE.trim());
  assert.equal(exportText.split('\n\n')[0], OVERRIDE.trim());
});

test('an override for another species is rejected', () => {
  assert.throws(() => loadSetOverride('charizard', {charizard: OVERRIDE.replace('Charizard', 'Blastoise')}), TeamAssemblyError);
});

test('override exports lose their label nickname and Tera line and gain Level: 100', () => {
  const normalized = normalizeOverrideExport('Specs (Charizard) (M) @ Choice Specs\nAbility: Blaze\nTera Type: Fire\n- Flamethrower');
  assert.equal(normalized, 'Charizard (M) @ Choice Specs\nLevel: 100\nAbility: Blaze\n- Flamethrower');
});

test('selectable sets: overrides first, labelled, Mega detected, source duplicates dropped', () => {
  const smogonSets = loadUsableSmogonSets(data.smogon, data);
  const randbatsSets = loadRandomBattleSets(data.randbats);
  const overrides = {
    charizard: 'Sun Sweeper (Charizard) @ Charizardite Y\nAbility: Blaze\n- Flamethrower\n- Solar Beam\n- Focus Blast\n- Roost\n\n'
      + 'Charizard @ Charizardite X\nAbility: Blaze\n- Flare Blitz\n- Dragon Claw\n- Roost\n- Swords Dance\n\n'
      + smogonSets.charizard[0].export,
  };
  const options = selectableSets('charizard', {smogonSets, randbatsSets, pokedex: data.pokedex, overrides});
  assert.deepEqual(options.slice(0, 3).map((o) => [o.setId, o.label, o.isMega, o.megaForme]), [
    ['override:0', 'Sun Sweeper', true, 'charizardmegay'],
    ['override:1', 'Mega X', true, 'charizardmegax'],
    ['override:2', 'Custom 3', false, null],
  ]);
  assert.ok(!options[0].export.includes('Sun Sweeper'));
  // the copied Smogon set shows once (as the override), the rest of the source sets follow
  assert.equal(options.filter((o) => o.source === 'smogon').length, smogonSets.charizard.length - 1);
  assert.ok(!options.some((o) => o.setId === 'smogon:0'));

  const randbatsOnly = selectableSets('charizard', {smogonSets: {}, randbatsSets, pokedex: data.pokedex});
  assert.ok(randbatsOnly.length > 0 && randbatsOnly.every((o) => o.source === 'randbats'));
  assert.ok(randbatsOnly[0].export.includes('Level: 100'));
});

test('assembleLoadout honours chosen set ids and falls back to the first option', () => {
  const loadout = Object.fromEntries(DRAFTED.map((id) => [id, 'smogon:0']));
  loadout.clefable = 'bogus:9';
  const smogonSets = loadUsableSmogonSets(data.smogon, data);
  // Without overrides the first option is the first Smogon set.
  const members = assembleLoadout(loadout, {...data, overrides: {}}).split('\n\n');
  assert.equal(members.length, 6);
  assert.equal(members[1], smogonSets.clefable[0].export);
  // With the checked-in Clefable override, the override comes first.
  const withOverride = assembleLoadout(loadout, data).split('\n\n');
  assert.equal(withOverride[1], selectableSets('clefable', {smogonSets, randbatsSets: {}, pokedex: data.pokedex, overrides: data.overrides})[0].export);
  assert.equal(withOverride[0], members[0]);
  assert.throws(() => assembleLoadout({charizard: 'smogon:0'}, data), /exactly 6/);
});

test('format exclusion matches the requested aliases', () => {
  for (const f of ['Godly Gift', '1V1', 'Battle Stadium Singles', 'BSS Series 2', 'National Dex Monotype', 'Almost Any Ability', 'AAA', 'Mix and Mega', 'Doubles', 'VGC']) {
    assert.ok(isFormatExcluded(f), f);
  }
  assert.ok(!isFormatExcluded('OU'));
});

test('tera type lines are stripped from Smogon exports', () => {
  assert.equal(stripTeraTypeLines('Abomasnow @ Eject Pack\nAbility: Snow Warning\nLevel: 100\nTera Type: Ghost\n- Blizzard\n'),
    'Abomasnow @ Eject Pack\nAbility: Snow Warning\nLevel: 100\n- Blizzard');
});

test('checked-in Smogon ingestion counts and validation report', () => {
  const [sets, report] = ingestSmogonSets(data.smogon, data);
  assert.equal(Object.keys(sets).length, 639);
  assert.equal(report.inputSetCount, 1115);
  assert.equal(report.usableSetCount, 1109);
  assert.equal(report.formatExcludedSetCount, 6);
  assert.deepEqual(report.matchedFormatStrings, ['Almost Any Ability', 'Godly Gift']);
  assert.deepEqual(report.validationIssues, []);
  // formes whose only scraped sets are side-format ones (scripts/smogon-scrape.ts skips cosmetic and item-locked formes)
  assert.deepEqual(report.allSetsExcludedOrFailedSpecies, ['arceusghost', 'arceuspoison', 'dialgaorigin', 'greninjabond', 'ogerponhearthflame', 'zamazentacrowned']);
  assert.ok(Object.values(sets).flat().every((s) => !s.export.includes('Tera Type:')));
});

test('checked-in Smogon ingestion excludes OM and doubles sets', () => {
  const [sets] = ingestSmogonSets(data.smogon, data);
  for (const id of ['greninjabond', 'ogerponhearthflame']) assert.ok(!(id in sets), id);
  // scripts/smogon-scrape.ts replaced the side-format-only entries these used to have
  for (const id of ['polteageist', 'regieleki', 'gougingfire', 'jumpluff']) assert.ok(id in sets, id);
  const banned = new Set(['Almost Any Ability', 'Mix and Mega', 'Doubles', 'VGC', 'Godly Gift', '1v1', 'BH']);
  assert.ok(Object.values(sets).flat().every((s) => !banned.has(s.format)));
});
