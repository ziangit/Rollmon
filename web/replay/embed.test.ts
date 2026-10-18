import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bossAvatar, replayDoc, withBossAvatar} from './embed.ts';

test('canonical trainer names map to their sprite; themed names get a stable pick', () => {
  assert.equal(bossAvatar('Cynthia'), 'cynthia');
  assert.equal(bossAvatar('Team Archie'), 'archie-gen6');
  assert.equal(bossAvatar('Bug Catchers United'), bossAvatar('Bug Catchers United'));
  assert.ok(bossAvatar('Drizzle').length > 0);
});

test('only the boss player line gets the avatar', () => {
  const log = ['|player|p1|Player||', '|player|p2|Boss||', '|turn|1'];
  assert.deepEqual(withBossAvatar(log, 'Leon', 'Player'), ['|player|p1|Player||', '|player|p2|Boss|leon|', '|turn|1']);
  assert.deepEqual(withBossAvatar(['|player|p2|Boss'], 'Leon', 'Player'), ['|player|p2|Boss|leon']);
});

test('replayDoc embeds the escaped protocol and the hosted player', () => {
  const doc = replayDoc(['|player|p2|Boss||', '|c|<b>x</b>'], 'Leon', 'Player');
  assert.ok(doc.includes('class="battle-log-data">|player|p2|Boss|leon|\n|c|&lt;b&gt;x&lt;/b&gt;</script>'));
  assert.ok(doc.includes('https://play.pokemonshowdown.com/js/replay-embed.js'));
});
