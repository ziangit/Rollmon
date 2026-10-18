import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLAYER_ROOT, PLAYER_SCRIPTS, bossAvatar, replayDoc, withBossAvatar} from './embed.ts';

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

test('replayDoc embeds the escaped protocol and loads the player scripts in order', () => {
  const doc = replayDoc(['|player|p2|Boss||', '|c|<b>x</b>'], 'Leon', 'Player');
  assert.ok(doc.includes('class="battle-log-data">|player|p2|Boss|leon|\n|c|&lt;b&gt;x&lt;/b&gt;</script>'));
  assert.ok(!doc.includes('replay-embed.js'), 'the racy hosted loader is not used');
  const srcs = [...doc.matchAll(/<script src="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(srcs, PLAYER_SCRIPTS.map((p) => `${PLAYER_ROOT}/${p}`));
  assert.ok(srcs.findIndex((s) => s.includes('jquery')) < srcs.findIndex((s) => s.includes('battledata')));
  assert.ok(srcs.findIndex((s) => s.includes('battledata')) < srcs.findIndex((s) => s.includes('graphics')));
  assert.ok(srcs.at(-1)!.includes('/js/battle.js'));
  assert.ok(doc.indexOf('class="battle-log-data"') < doc.indexOf('<script src='), 'the log precedes the scripts');
  assert.ok(doc.trimEnd().endsWith('</script>') && doc.includes('new Battle({'));
});
