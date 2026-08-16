import assert from 'node:assert/strict'
import { randomBytes, scrypt } from 'node:crypto'
import { describe, it } from 'node:test'

import { hashPassword, needsRehash, verifyPassword } from '../app/actions/auth/password.ts'

// Writes a hash the way the app did before the parameters were stored beside
// them: `salt:key`, at Node's scrypt defaults. Rows in this shape exist in
// production, so verifyPassword has to keep reading them indefinitely.
function legacyHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) =>
      error ? reject(error) : resolve(`${salt.toString('hex')}:${key.toString('hex')}`),
    )
  })
}

// Same, at an explicit cost, to stand in for a hash written under a target
// somewhere between the legacy default and the current one.
function encodedHashAt(password: string, N: number): Promise<string> {
  const salt = randomBytes(16)
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 256 * N * 8 }, (error, key) =>
      error
        ? reject(error)
        : resolve(`scrypt$N=${N},r=8,p=1$${salt.toString('hex')}$${key.toString('hex')}`),
    )
  })
}

describe('hashPassword', () => {
  it('writes a self-describing hash', async () => {
    const stored = await hashPassword('correct horse battery staple')
    const [algorithm, settings, saltHex, keyHex, ...rest] = stored.split('$')

    assert.equal(algorithm, 'scrypt')
    assert.match(settings, /^N=\d+,r=\d+,p=\d+$/)
    assert.equal(saltHex.length, 32, '16-byte salt, hex encoded')
    assert.equal(keyHex.length, 128, '64-byte key, hex encoded')
    assert.equal(rest.length, 0)
  })

  it('salts each hash separately, so equal passwords do not collide', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')])
    assert.notEqual(a, b)
    assert.ok(await verifyPassword('same', a))
    assert.ok(await verifyPassword('same', b))
  })
})

describe('verifyPassword', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const stored = await hashPassword('hunter2')
    assert.equal(await verifyPassword('hunter2', stored), true)
    assert.equal(await verifyPassword('hunter3', stored), false)
    assert.equal(await verifyPassword('', stored), false)
  })

  // The reason the parameters are stored rather than assumed.
  it('still reads a hash written in the old format', async () => {
    const stored = await legacyHash('hunter2')
    assert.equal(await verifyPassword('hunter2', stored), true)
    assert.equal(await verifyPassword('wrong', stored), false)
  })

  it('reads a hash written at a cost between the old and current ones', async () => {
    const stored = await encodedHashAt('hunter2', 32768)
    assert.equal(await verifyPassword('hunter2', stored), true)
    assert.equal(await verifyPassword('wrong', stored), false)
  })

  it('refuses an unreadable hash rather than throwing out of the login', async () => {
    for (const stored of [
      '',
      'nonsense',
      'scrypt$$$',
      'scrypt$N=abc,r=8,p=1$aabb$ccdd',
      'scrypt$N=0,r=8,p=1$aabb$ccdd',
      'scrypt$N=16384,r=8$aabb$ccdd',
      'scrypt$q=1,r=8,p=1$aabb$ccdd',
      'aabb:ccdd:eeff',
    ]) {
      assert.equal(await verifyPassword('hunter2', stored), false, `should refuse ${JSON.stringify(stored)}`)
    }
  })
})

describe('needsRehash', () => {
  it('is false for a hash just written', async () => {
    assert.equal(needsRehash(await hashPassword('hunter2')), false)
  })

  it('is true for the old format', async () => {
    assert.equal(needsRehash(await legacyHash('hunter2')), true)
  })

  // A format check alone would call this current and never upgrade it.
  it('is true for an encoded hash below the current cost', async () => {
    assert.equal(needsRehash(await encodedHashAt('hunter2', 32768)), true)
  })

  it('is false for an unreadable hash, which rehashing cannot fix', () => {
    assert.equal(needsRehash('nonsense'), false)
  })
})

// LEGACY_PARAMS is the only record of what pre-format hashes were written under,
// and nothing else in the system can detect it being wrong — a bad value shows
// up as every un-migrated user being unable to log in. This is that check.
describe('the assumed legacy cost', () => {
  it('matches Node scrypt defaults, which is what those hashes used', async () => {
    const password = 'hunter2'
    const salt = randomBytes(16)

    const atDefaults = await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, (error, key) => (error ? reject(error) : resolve(key)))
    })
    const stored = `${salt.toString('hex')}:${atDefaults.toString('hex')}`

    assert.equal(await verifyPassword(password, stored), true)
  })
})
