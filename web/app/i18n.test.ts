import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectLang, localSpeciesName, setLang, t, translations} from './i18n.ts';
import {loadGameData} from '../scripts/game-data.ts';

test('both translation tables cover the same keys and keep every placeholder', () => {
  const zh = translations('zh'), ja = translations('ja');
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(ja).sort());
  for (const [key, value] of [...Object.entries(zh), ...Object.entries(ja)]) {
    const want = [...key.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const got = [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(got, want, `placeholders differ for "${key}"`);
  }
  assert.ok(Object.keys(zh).length > 150);
});

test('t() falls back to the key and fills placeholders', () => {
  setLang('en');
  assert.equal(t('Round {n} of 6', {n: 3}), 'Round 3 of 6');
  setLang('zh');
  assert.equal(t('Round {n} of 6', {n: 3}), '第 3 / 6 轮');
  assert.equal(t('not a key'), 'not a key');
  setLang('ja');
  assert.equal(t('Pick {name}', {name: 'ピカチュウ'}), 'ピカチュウ を選ぶ');
  setLang('en');
});

test('language detection prefers the stored choice, then the browser language', () => {
  assert.equal(detectLang('zh-CN', null), 'zh');
  assert.equal(detectLang('ja-JP', null), 'ja');
  assert.equal(detectLang('en-US', null), 'en');
  assert.equal(detectLang('zh-CN', 'en'), 'en');
  assert.equal(detectLang(undefined, 'bogus'), 'en');
});

test('species names localise by dex number and keep the forme suffix', () => {
  const data = loadGameData();
  const dex = data.pokedex as Record<string, {num: number; forme?: string}>;
  setLang('zh');
  assert.equal(localSpeciesName('Pikachu', dex.pikachu, data.speciesNames), '皮卡丘');
  assert.equal(localSpeciesName('Raichu-Alola', dex.raichualola, data.speciesNames), '雷丘-Alola');
  setLang('ja');
  assert.equal(localSpeciesName('Garchomp', dex.garchomp, data.speciesNames), 'ガブリアス');
  setLang('en');
  assert.equal(localSpeciesName('Garchomp', dex.garchomp, data.speciesNames), 'Garchomp');
  assert.equal(localSpeciesName('Missingno', undefined, data.speciesNames), 'Missingno');
});
