import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanName, cookieValue, hashPassword, nameId, readSession, sessionCookie, sessionToken, validPassword, verifyPassword} from './auth.ts';

test('names: Showdown-style identity, bounded display spelling, CJK allowed', () => {
  assert.equal(nameId('R.e.d  '), 'red');
  assert.equal(nameId('皮卡丘'), '皮卡丘');
  assert.equal(nameId('ＡＢＣ'), 'abc', 'full-width letters fold to ASCII');
  assert.deepEqual(cleanName('  Ash   Ketchum\u0007 '), {name: 'Ash Ketchum', id: 'ashketchum'});
  assert.deepEqual(cleanName('皮卡丘'), {name: '皮卡丘', id: '皮卡丘'});
  assert.equal(cleanName('!!!'), null, 'needs a letter or digit');
  assert.equal(cleanName(''), null);
  assert.equal(cleanName('x'.repeat(19)), null);
  assert.equal(cleanName('Admin'), null, 'reserved');
  assert.equal(cleanName(42), null);
  assert.ok(validPassword('hunter22'));
  assert.ok(!validPassword('short'));
  assert.ok(!validPassword('x'.repeat(129)));
  assert.ok(!validPassword(12345678));
});

test('passwords are salted scrypt hashes', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.notEqual(a, b, 'fresh salt each time');
  assert.ok(a.startsWith('scrypt$'));
  assert.ok(await verifyPassword('correct horse', a));
  assert.ok(!(await verifyPassword('correct horsf', a)));
  assert.ok(!(await verifyPassword('correct horse', 'plain$nope')));
});

test('sessions are signed cookies that expire and reject tampering', () => {
  const t0 = 1_700_000_000_000;
  const token = sessionToken('s3cret', {id: 7, name: 'Red'}, t0);
  assert.deepEqual(readSession('s3cret', token, t0 + 1000), {id: 7, name: 'Red'});
  assert.equal(readSession('s3cret', token, t0 + 31 * 86_400_000), null, 'expired');
  assert.equal(readSession('other', token, t0), null, 'wrong secret');
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({u: 1, n: 'Admin', e: t0 + 1e9})).toString('base64url');
  assert.equal(readSession('s3cret', `${forged}.${sig}`, t0), null, 'edited payload');
  assert.equal(readSession('s3cret', `${payload}.${sig.slice(1)}`, t0), null, 'edited signature');
  assert.equal(readSession('s3cret', null, t0), null);
  const header = sessionCookie(token);
  assert.match(header, /^rollmons_session=.+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal(cookieValue(`a=1; ${header.split(';')[0]}; b=2`, 'rollmons_session'), token);
  assert.equal(cookieValue(undefined, 'rollmons_session'), null);
  assert.match(sessionCookie(null), /^rollmons_session=; Max-Age=0;/);
});
